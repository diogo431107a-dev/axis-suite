// Liked replies. A like with a comment is praise: the memory model reads it at its next run, next
// to the reasons you gave for rejecting replies, and keeps what it shows in feedback.md. A like
// without one is only for you, and nothing is sent anywhere. Either way, nothing goes into the
// chat's own messages, so the prompt cache and the companion's earlier thinking are left alone.
//
// A like keeps the reply's words as they were when you liked it, the way a pin keeps its text:
// the praise is about those words, even if the reply is edited later. And once memory has heard of
// it, a like that is unliked, loses its comment or whose reply is deleted is passed on as withdrawn,
// so whatever came only from it can be taken back; until then its row stays, with `withdrawn_at`.
import type { DatabaseSync } from "node:sqlite";
import { blockText, LIMITS, type Liked, type Message } from "../shared/protocol.ts";
import type { Chats } from "./chat/chats.ts";
import { createTree } from "./chat/tree.ts";
import { text as checkText } from "./check.ts";
import { invalid } from "./errors.ts";

interface Row {
  id: number;
  message_id: number;
  text: string;
  comment: string | null;
  filed_comment: string | null;
  withdrawn_at: string | null;
}

/** How many of a liked reply's other versions the memory model sees, and how much of each. */
const PASSED_OVER = 3;
const PASSED_OVER_CHARS = 1_000;

const wordsOf = (message: Message): string => message.content.map(blockText).join("").trim();

const cut = (words: string, max: number): string => (words.length > max ? `${words.slice(0, max).trimEnd()}…` : words);

/** Which of these messages you liked, and what you said about them. */
export function likedAmong(db: DatabaseSync, chatId: string, messageIds: number[]): Liked[] {
  const rows = db
    .prepare("SELECT message_id, comment FROM likes WHERE chat_id = ? AND withdrawn_at IS NULL")
    .all(chatId) as { message_id: number; comment: string | null }[];
  const liked = new Map(rows.map((row) => [row.message_id, row.comment]));
  return messageIds.filter((id) => liked.has(id)).map((id) => ({ messageId: id, comment: liked.get(id) ?? null }));
}

/** Praise the memory model hasn't been told about yet, or that it has to take back. */
export interface Praise {
  likeId: number;
  kind: "new" | "changed" | "withdrawn";
  /** The reply's words when you liked it. */
  text: string;
  /** What you say now; null when withdrawn. */
  comment: string | null;
  /** What memory was told before: for a changed or withdrawn like. */
  before: string | null;
  /** Whether the liked version is on the selected path. */
  onPath: boolean;
  isGreeting: boolean;
  /** Other versions of the same reply, a few of them, cut short. */
  passedOver: string[];
}

interface PraiseRow extends Row {
  parent_id: number | null;
  is_greeting: number;
  deleted_at: string | null;
}

function praiseOf(db: DatabaseSync, chatId: string, row: PraiseRow, kind: Praise["kind"], onPath: Set<number>): Praise {
  const tree = createTree(db, chatId);
  const passedOver =
    kind === "withdrawn"
      ? []
      : tree
          .siblingsOf({ parentId: row.parent_id, role: "assistant" })
          .filter((id) => id !== row.message_id)
          .slice(-PASSED_OVER)
          .map((id) => cut(wordsOf(tree.get(id)), PASSED_OVER_CHARS))
          .filter(Boolean);
  return {
    likeId: row.id,
    kind,
    text: row.text,
    comment: kind === "withdrawn" ? null : row.comment,
    before: kind === "new" ? null : row.filed_comment,
    onPath: onPath.has(row.message_id),
    isGreeting: row.is_greeting === 1,
    passedOver,
  };
}

const praiseRows = (db: DatabaseSync, chatId: string): PraiseRow[] =>
  db
    .prepare(
      `SELECT l.id, l.message_id, l.text, l.comment, l.filed_comment, l.withdrawn_at,
              m.parent_id, m.is_greeting, m.deleted_at
       FROM likes l JOIN messages m ON m.id = l.message_id
       WHERE l.chat_id = ? ORDER BY l.id`,
    )
    .all(chatId) as unknown as PraiseRow[];

/** What memory doesn't have yet of the praise in a chat: new, changed and withdrawn. */
export function praiseFor(db: DatabaseSync, chatId: string, onPath: Set<number>): Praise[] {
  const praise: Praise[] = [];
  for (const row of praiseRows(db, chatId)) {
    const gone = row.withdrawn_at !== null || row.deleted_at !== null;
    const now = gone ? null : row.comment;
    if (now === row.filed_comment) continue;
    if (now === null) praise.push(praiseOf(db, chatId, row, "withdrawn", onPath));
    else praise.push(praiseOf(db, chatId, row, row.filed_comment === null ? "new" : "changed", onPath));
  }
  return praise;
}

/** Every live like with a comment in a chat, as new: for a rebuild, which starts memory empty. */
export function allPraise(db: DatabaseSync, chatId: string, onPath: Set<number>): Praise[] {
  return praiseRows(db, chatId)
    .filter((row) => row.withdrawn_at === null && row.deleted_at === null && row.comment !== null)
    .map((row) => praiseOf(db, chatId, row, "new", onPath));
}

/**
 * Records that memory now has this praise, as it was when the run read it: anything changed while
 * the run was working stays pending. A withdrawn like whose row is no longer needed goes.
 */
export function markFiled(db: DatabaseSync, praise: Praise[], at: string): void {
  const filed = db.prepare("UPDATE likes SET filed_comment = ?, consolidated_at = ? WHERE id = ?");
  const drop = db.prepare(
    `DELETE FROM likes WHERE id = ? AND (withdrawn_at IS NOT NULL
       OR EXISTS (SELECT 1 FROM messages m WHERE m.id = likes.message_id AND m.deleted_at IS NOT NULL))`,
  );
  for (const item of praise) {
    if (item.kind === "withdrawn") {
      drop.run(item.likeId);
      filed.run(null, at, item.likeId);
    } else filed.run(item.comment, at, item.likeId);
  }
}

/** Before a rebuild is swapped in: memory starts over, so it has no praise but what it was just given. */
export function forgetFiled(db: DatabaseSync, chatId: string): void {
  db.prepare("UPDATE likes SET filed_comment = NULL, consolidated_at = NULL WHERE chat_id = ?").run(chatId);
  db.prepare(
    `DELETE FROM likes WHERE chat_id = ? AND (withdrawn_at IS NOT NULL
       OR EXISTS (SELECT 1 FROM messages m WHERE m.id = likes.message_id AND m.deleted_at IS NOT NULL))`,
  ).run(chatId);
}

/** One person's likes. */
export function createLikes(db: DatabaseSync, chats: Chats) {
  const rowOf = (messageId: number): Row | undefined =>
    db
      .prepare("SELECT id, message_id, text, comment, filed_comment, withdrawn_at FROM likes WHERE message_id = ?")
      .get(messageId) as Row | undefined;

  return {
    /**
     * Likes one of the companion's replies, or changes what you said about it. A comment left out
     * keeps the one there is; null or empty means none: liked only for you.
     */
    like(chatId: string, messageId: number, comment?: unknown, now = new Date().toISOString()): void {
      const message = chats.tree(chatId).get(messageId);
      if (message.role !== "assistant") invalid("Only the companion's replies can be liked");
      if (message.reply?.stopReason === "refusal") invalid("A declined reply can't be liked");
      const words = wordsOf(message);
      if (!words) invalid("An empty reply can't be liked");
      const said =
        comment === undefined
          ? undefined
          : comment === null
            ? null
            : checkText(comment, LIMITS.likeComment, "The comment") || null;

      const row = rowOf(message.id);
      if (!row) {
        db.prepare(
          `INSERT INTO likes (chat_id, message_id, text, comment, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(chatId, message.id, words, said ?? null, now, now);
      } else if (row.withdrawn_at !== null) {
        // Liked again before memory heard it was unliked: the words are the ones liked now.
        db.prepare("UPDATE likes SET text = ?, comment = ?, withdrawn_at = NULL, updated_at = ? WHERE id = ?").run(
          words,
          said ?? null,
          now,
          row.id,
        );
      } else if (said !== undefined) {
        db.prepare("UPDATE likes SET comment = ?, updated_at = ? WHERE id = ?").run(said, now, row.id);
      }
    },

    /** Takes a like back. Memory, if it heard of it, is told at its next run. */
    unlike(chatId: string, messageId: number, now = new Date().toISOString()): void {
      const message = chats.tree(chatId).get(messageId);
      const row = rowOf(message.id);
      if (!row || row.withdrawn_at !== null) return;
      if (row.filed_comment === null) db.prepare("DELETE FROM likes WHERE id = ?").run(row.id);
      else
        db.prepare("UPDATE likes SET comment = NULL, withdrawn_at = ?, updated_at = ? WHERE id = ?").run(
          now,
          now,
          row.id,
        );
    },
  };
}

export type Likes = ReturnType<typeof createLikes>;
