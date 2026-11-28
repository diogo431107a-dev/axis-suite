// A chat is a tree of messages, and one path through it is "what happened".
//
// Messages under the same parent are alternatives: swipes when they are replies, branches when
// they are yours. `chats.active_leaf_id` marks the end of the selected path; walking up from it
// through `parent_id` gives the conversation the model is sent. Nothing here removes a row: a
// delete stamps `deleted_at`, an edit keeps the old words in `message_revisions`, and messages
// that fall off the selected path stay where they are, to be selected again or rebuilt from.
//
// When something already folded into the companion's memory is edited, deleted or left behind
// on another branch, it is marked `needs_correction`, so the next consolidation can take back
// whatever came only from it.
import type { DatabaseSync } from "node:sqlite";
import type { ContentBlock, Message, PathEntry, ReplyDetails } from "../../shared/protocol.ts";
import { transaction } from "../db.ts";
import { invalid, notFound } from "../errors.ts";
import { OFF_RECORD_NOW } from "../memory/record.ts";

interface Row {
  id: number;
  parent_id: number | null;
  role: "user" | "assistant";
  content: string;
  instruction: string | null;
  is_greeting: number;
  reply: string | null;
  created_at: string;
  edited_at: string | null;
}

const COLUMNS = "id, parent_id, role, content, instruction, is_greeting, reply, created_at, edited_at";

export const messageOf = (row: Row): Message => ({
  id: row.id,
  parentId: row.parent_id,
  role: row.role,
  content: JSON.parse(row.content) as ContentBlock[],
  instruction: row.instruction,
  isGreeting: row.is_greeting === 1,
  at: row.created_at,
  editedAt: row.edited_at,
  reply: row.reply ? (JSON.parse(row.reply) as ReplyDetails) : null,
});

export interface NewMessage {
  parentId: number | null;
  role: "user" | "assistant";
  content: ContentBlock[];
  instruction?: string | null;
  isGreeting?: boolean;
  reply?: ReplyDetails | null;
  at?: string;
}

/** The tree of one chat. The chat's ownership is checked by whoever makes this. */
export function createTree(db: DatabaseSync, chatId: string) {
  const live = (id: number): Row | undefined =>
    db
      .prepare(`SELECT ${COLUMNS} FROM messages WHERE id = ? AND chat_id = ? AND deleted_at IS NULL`)
      .get(id, chatId) as Row | undefined;

  function get(id: number): Message {
    const row = live(id);
    return row ? messageOf(row) : notFound("message");
  }

  function activeLeaf(): number | null {
    const row = db.prepare("SELECT active_leaf_id FROM chats WHERE id = ?").get(chatId) as
      { active_leaf_id: number | null } | undefined;
    return row?.active_leaf_id ?? null;
  }

  /** The messages from the first one down to `leafId`, in order. Empty for null. */
  function pathTo(leafId: number | null): Message[] {
    if (leafId === null) return [];
    const rows = db
      .prepare(
        `WITH RECURSIVE up(id, depth) AS (
           SELECT id, 0 FROM messages WHERE id = ? AND chat_id = ?
           UNION ALL
           SELECT m.parent_id, up.depth + 1 FROM messages m JOIN up ON m.id = up.id WHERE m.parent_id IS NOT NULL
         )
         SELECT ${COLUMNS.split(", ")
           .map((column) => `m.${column}`)
           .join(", ")}
         FROM up JOIN messages m ON m.id = up.id ORDER BY up.depth DESC`,
      )
      .all(leafId, chatId) as unknown as Row[];
    return rows.map(messageOf);
  }

  /** The live alternatives of a message: same parent, same role, oldest first, itself included. */
  function siblingsOf(message: Pick<Message, "parentId" | "role">): number[] {
    const rows = db
      .prepare(
        `SELECT id FROM messages
         WHERE chat_id = ? AND parent_id IS ? AND role = ? AND deleted_at IS NULL ORDER BY id`,
      )
      .all(chatId, message.parentId, message.role) as { id: number }[];
    return rows.map((row) => row.id);
  }

  /** The end of the newest line of messages below `id` (or `id` itself, when nothing is). */
  function newestLeafBelow(id: number): number {
    let at = id;
    const child = db.prepare(
      "SELECT id FROM messages WHERE chat_id = ? AND parent_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1",
    );
    for (;;) {
      const next = child.get(chatId, at) as { id: number } | undefined;
      if (!next) return at;
      at = next.id;
    }
  }

  /** Whether the user was already asked why the replies under `parentId` keep being rejected. */
  function feedbackFor(parentId: number | null): { reason: string | null } | undefined {
    return db
      .prepare("SELECT reason FROM swipe_feedback WHERE chat_id = ? AND ifnull(parent_id, 0) = ifnull(?, 0)")
      .get(chatId, parentId) as { reason: string | null } | undefined;
  }

  /**
   * Moves the end of the selected path, and marks what was folded into memory and is no longer
   * on it. The chat counts as active now.
   */
  function setLeaf(leafId: number | null, now = new Date().toISOString()): void {
    transaction(db, () => {
      const before = new Set(pathTo(activeLeaf()).map((message) => message.id));
      for (const message of pathTo(leafId)) before.delete(message.id);
      const mark = db.prepare("UPDATE messages SET needs_correction = 1 WHERE id = ? AND consolidated_at IS NOT NULL");
      for (const id of before) mark.run(id);
      db.prepare("UPDATE chats SET active_leaf_id = ?, last_activity_at = ? WHERE id = ?").run(leafId, now, chatId);
    });
  }

  return {
    get,
    pathTo,
    siblingsOf,
    feedbackFor,
    activeLeaf,
    setLeaf,

    /** The selected path, from the first message to the last. */
    activePath(): Message[] {
      return pathTo(activeLeaf());
    },

    /** The selected path, each message with its alternatives and whether to ask about them. */
    entries(swipeAsk: number): PathEntry[] {
      return pathTo(activeLeaf()).map((message) => {
        const siblings = siblingsOf(message);
        const ask =
          message.role === "assistant" &&
          siblings.length - 1 >= swipeAsk &&
          feedbackFor(message.parentId) === undefined;
        return { message, siblings, ask };
      });
    },

    /** Adds a message under its parent. It does not move the selected path; setLeaf does. */
    add(message: NewMessage): Message {
      if (message.parentId !== null) get(message.parentId);
      const { lastInsertRowid } = db
        .prepare(
          `INSERT INTO messages (chat_id, parent_id, role, content, instruction, is_greeting, reply, created_at,
                                 off_record)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${OFF_RECORD_NOW})`,
        )
        .run(
          chatId,
          message.parentId,
          message.role,
          JSON.stringify(message.content),
          message.instruction ?? null,
          message.isGreeting ? 1 : 0,
          message.reply ? JSON.stringify(message.reply) : null,
          message.at ?? new Date().toISOString(),
          chatId,
        );
      return get(Number(lastInsertRowid));
    },

    /** Selects a message: the path now runs through it, down to the newest line below it. */
    select(id: number): void {
      get(id);
      setLeaf(newestLeafBelow(id));
    },

    /** Ends the selected path at this message, so what you say next branches off here. */
    branchFrom(id: number): void {
      get(id);
      setLeaf(id);
    },

    /**
     * Changes what a message says, keeping the old words. A reply loses its thinking with it:
     * the reasoning was for words that are no longer there.
     */
    edit(id: number, text: string, now = new Date().toISOString()): Message {
      const before = get(id);
      if (!text.trim()) invalid("A message can't be empty. Delete it instead.");
      transaction(db, () => {
        db.prepare("INSERT INTO message_revisions (message_id, content, replaced_at) VALUES (?, ?, ?)").run(
          id,
          JSON.stringify(before.content),
          now,
        );
        db.prepare(
          `UPDATE messages SET content = ?, edited_at = ?,
             needs_correction = CASE WHEN consolidated_at IS NOT NULL THEN 1 ELSE needs_correction END
           WHERE id = ?`,
        ).run(JSON.stringify([{ type: "text", text }]), now, id);
      });
      return get(id);
    },

    /**
     * Deletes a message and everything below it. If it was on the selected path, the path moves
     * to its newest surviving alternative, or ends at its parent.
     */
    remove(id: number, now = new Date().toISOString()): void {
      const message = get(id);
      transaction(db, () => {
        const onPath = pathTo(activeLeaf()).some((entry) => entry.id === id);
        db.prepare(
          `WITH RECURSIVE down(id) AS (
             SELECT ?
             UNION ALL
             SELECT m.id FROM messages m JOIN down ON m.parent_id = down.id
           )
           UPDATE messages SET deleted_at = ?,
             needs_correction = CASE WHEN consolidated_at IS NOT NULL THEN 1 ELSE needs_correction END
           WHERE id IN (SELECT id FROM down) AND deleted_at IS NULL`,
        ).run(id, now);
        if (!onPath) return;
        const survivor = siblingsOf(message).at(-1);
        // The marks for deleted messages are already set above; setLeaf adds the rest.
        setLeaf(survivor !== undefined ? newestLeafBelow(survivor) : message.parentId, now);
      });
    },
  };
}

export type Tree = ReturnType<typeof createTree>;
