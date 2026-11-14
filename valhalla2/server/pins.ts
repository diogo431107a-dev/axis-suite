// Pinned moments: words from a chat you chose to keep exactly as they are. They are sent in every
// chat with the companion, after its memory (memory/inject.ts), and the memory model never sees or
// changes them — that is the difference from memory, which is rewritten in the memory model's own
// words and condensed by tidy-ups.
//
// Adding or removing one clears the snapshot of the chat it came from, so that chat takes a fresh
// look at once; other chats with the companion see it the next time theirs is taken again.
import type { DatabaseSync } from "node:sqlite";
import { LIMITS, type Pin } from "../shared/protocol.ts";
import { messageId, object, required } from "./check.ts";
import type { Chats } from "./chat/chats.ts";
import { notFound, tooMany } from "./errors.ts";

interface Row {
  id: number;
  companion_id: string;
  chat_id: string | null;
  message_id: number | null;
  speaker: string;
  chat_title: string;
  text: string;
  created_at: string;
}

const pinOf = (row: Row): Pin => ({
  id: row.id,
  companionId: row.companion_id,
  chatId: row.chat_id,
  messageId: row.message_id,
  speaker: row.speaker,
  chatTitle: row.chat_title,
  text: row.text,
  createdAt: row.created_at,
});

/** A companion's pins, oldest first: the order they are sent in, so the same pins always read the same. */
export function pinsOf(db: DatabaseSync, companionId: string): Pin[] {
  const rows = db
    .prepare("SELECT * FROM pins WHERE companion_id = ? ORDER BY created_at, id")
    .all(companionId) as unknown as Row[];
  return rows.map(pinOf);
}

/** Which of these messages have something pinned from them. */
export function pinnedAmong(db: DatabaseSync, chatId: string, messageIds: number[]): number[] {
  const pinned = new Set(
    (db.prepare("SELECT DISTINCT message_id FROM pins WHERE chat_id = ?").all(chatId) as { message_id: number }[]).map(
      (row) => row.message_id,
    ),
  );
  return messageIds.filter((id) => pinned.has(id));
}

/** The chat takes a fresh look at memory, and so at its pins, on its next turn. */
const freshLook = (db: DatabaseSync, chatId: string | null) => {
  if (chatId !== null) db.prepare("UPDATE chats SET memory_snapshot = NULL WHERE id = ?").run(chatId);
};

/** One person's pins. */
export function createPins(db: DatabaseSync, owner: string, chats: Chats) {
  return {
    /** Pins words from a message of a chat: `{ messageId, speaker, text }`. */
    add(chatId: string, body: unknown, now = new Date().toISOString()): Pin {
      const chat = chats.get(chatId);
      const fields = object(body);
      const message = chats.tree(chat.id).get(messageId(fields.messageId));
      const speaker = required(fields.speaker, LIMITS.pinSpeaker, "Who said it");
      const text = required(fields.text, LIMITS.pinText, "The pinned words");
      const { count } = db
        .prepare("SELECT count(*) AS count FROM pins WHERE companion_id = ?")
        .get(chat.companionId) as {
        count: number;
      };
      if (count >= LIMITS.pins) tooMany(`A companion keeps ${LIMITS.pins} pinned moments at most. Remove one first.`);
      const { id } = db
        .prepare(
          `INSERT INTO pins (companion_id, chat_id, message_id, speaker, chat_title, text, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .get(chat.companionId, chat.id, message.id, speaker, chat.title, text, now) as { id: number };
      freshLook(db, chat.id);
      return pinsOf(db, chat.companionId).find((pin) => pin.id === id)!;
    },

    /** Unpins a moment of one of this person's companions. */
    remove(companionId: string, pinId: number): void {
      const row = db
        .prepare(
          `SELECT n.chat_id FROM pins n JOIN companions p ON p.id = n.companion_id
           WHERE n.id = ? AND n.companion_id = ? AND p.owner = ?`,
        )
        .get(pinId, companionId, owner) as { chat_id: string | null } | undefined;
      if (!row) notFound("pinned moment");
      db.prepare("DELETE FROM pins WHERE id = ?").run(pinId);
      freshLook(db, row.chat_id);
    },
  };
}

export type Pins = ReturnType<typeof createPins>;
