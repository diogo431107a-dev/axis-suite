// One person's chats: which companion, which mode, and the tree of what was said.
import type { DatabaseSync } from "node:sqlite";
import {
  CHAT_MODES,
  LIMITS,
  type Chat,
  type ChatMode,
  type ChatPage,
  type ChatSummary,
} from "../../shared/protocol.ts";
import { id as checkId, object, oneOf, text } from "../check.ts";
import type { Companions } from "../companions.ts";
import { conflict, notFound, tooMany } from "../errors.ts";
import { likedAmong } from "../likes.ts";
import { hasPending } from "../memory/consolidate.ts";
import { picturesOn } from "../pictures/store.ts";
import { pinnedAmong } from "../pins.ts";
import { createTree } from "./tree.ts";

interface Row {
  id: string;
  companion_id: string;
  title: string;
  mode: ChatMode;
  active_leaf_id: number | null;
  created_at: string;
  last_activity_at: string;
}

const chatOf = (row: Row): Chat => ({
  id: row.id,
  companionId: row.companion_id,
  title: row.title,
  mode: row.mode,
  activeLeafId: row.active_leaf_id,
  createdAt: row.created_at,
  lastActivityAt: row.last_activity_at,
});

/** One person's chats. `swipeAsk`: how many swipes on one reply before asking why. */
export function createChats(db: DatabaseSync, owner: string, companions: Companions, swipeAsk: number) {
  function get(id: string): Chat {
    const row = db
      .prepare(
        `SELECT c.id, c.companion_id, c.title, c.mode, c.active_leaf_id, c.created_at, c.last_activity_at
         FROM chats c JOIN companions p ON p.id = c.companion_id
         WHERE c.id = ? AND p.owner = ?`,
      )
      .get(id, owner) as Row | undefined;
    return row ? chatOf(row) : notFound("chat");
  }

  return {
    get,

    /** The tree of a chat of this person's. */
    tree(id: string) {
      get(id);
      return createTree(db, id);
    },

    list(): ChatSummary[] {
      const rows = db
        .prepare(
          `SELECT c.id, c.title, c.mode, c.companion_id, p.name AS companion_name, c.last_activity_at
           FROM chats c JOIN companions p ON p.id = c.companion_id
           WHERE p.owner = ? ORDER BY c.last_activity_at DESC`,
        )
        .all(owner) as {
        id: string;
        title: string;
        mode: ChatMode;
        companion_id: string;
        companion_name: string;
        last_activity_at: string;
      }[];
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        mode: row.mode,
        companionId: row.companion_id,
        companionName: row.companion_name,
        lastActivityAt: row.last_activity_at,
      }));
    },

    /** Opens an empty chat with a companion. The greeting is asked for separately, as a stream. */
    create(body: unknown): Chat {
      const fields = object(body);
      const id = checkId(fields.id);
      if (db.prepare("SELECT 1 FROM chats WHERE id = ?").get(id)) conflict("That id is already taken");
      const companion = companions.get(checkId(fields.companionId));
      const { count } = db
        .prepare("SELECT count(*) AS count FROM chats c JOIN companions p ON p.id = c.companion_id WHERE p.owner = ?")
        .get(owner) as { count: number };
      if (count >= LIMITS.chats) tooMany(`Valhalla 2 keeps ${LIMITS.chats} chats at most`);
      const mode = oneOf<ChatMode>(fields.mode ?? "canon", CHAT_MODES, "The mode");
      const title = text(fields.title ?? "", LIMITS.title, "The title") || companion.name;
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO chats (id, companion_id, title, mode, active_leaf_id, created_at, last_activity_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      ).run(id, companion.id, title, mode, now, now);
      return get(id);
    },

    /**
     * Renames a chat or changes its mode. A mode change on a chat whose messages are already in
     * memory marks them for correction: what they put there was filed under the other mode.
     */
    change(id: string, body: unknown): Chat {
      const chat = get(id);
      const fields = object(body);
      const title =
        fields.title === undefined ? chat.title : text(fields.title, LIMITS.title, "The title") || chat.title;
      const mode = fields.mode === undefined ? chat.mode : oneOf<ChatMode>(fields.mode, CHAT_MODES, "The mode");
      db.prepare("UPDATE chats SET title = ?, mode = ? WHERE id = ?").run(title, mode, id);
      // The companion is told which mode the chat is in, with its memory: take a fresh look.
      if (mode !== chat.mode) db.prepare("UPDATE chats SET memory_snapshot = NULL WHERE id = ?").run(id);
      if (mode !== chat.mode) {
        db.prepare("UPDATE messages SET needs_correction = 1 WHERE chat_id = ? AND consolidated_at IS NOT NULL").run(
          id,
        );
      }
      return get(id);
    },

    remove(id: string): void {
      get(id);
      db.prepare("DELETE FROM chats WHERE id = ?").run(id);
    },

    /** Everything the page needs to show a chat. */
    page(id: string): ChatPage {
      const chat = get(id);
      const path = createTree(db, id).entries(swipeAsk);
      const onPath = path.map((entry) => entry.message.id);
      return {
        chat,
        companion: companions.get(chat.companionId),
        path,
        windowStart: (
          db.prepare("SELECT window_start FROM chats WHERE id = ?").get(id) as { window_start: number | null }
        ).window_start,
        memoryPending: hasPending(db, id),
        pictures: picturesOn(db, id, onPath),
        pinned: pinnedAmong(db, id, onPath),
        liked: likedAmong(db, id, onPath),
      };
    },

    /**
     * Records why the replies under `parentId` keep being rejected, or that you'd rather not say
     * (null). Asked once per message: a second answer replaces the first.
     */
    feedback(id: string, parentId: number | null, reason: string | null): void {
      const tree = createTree(db, get(id).id);
      if (parentId !== null) tree.get(parentId);
      db.prepare(
        `INSERT INTO swipe_feedback (chat_id, parent_id, reason, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (chat_id, ifnull(parent_id, 0)) DO UPDATE SET reason = excluded.reason, consolidated_at = NULL`,
      ).run(id, parentId, reason, new Date().toISOString());
    },
  };
}

export type Chats = ReturnType<typeof createChats>;
