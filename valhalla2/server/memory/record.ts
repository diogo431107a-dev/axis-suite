// Pausing memory in a chat: what is written while it is paused is held back from the memory model.
//
// A message, or a reason you gave for rejecting replies, written while a chat's memory is paused is
// marked off the record (1). The memory model never reads it: not as a new message, not as context,
// not as what replaced an abandoned one, nor a like on it. When you resume you choose: keep it, and
// it is filed as usual (0), or leave it out for good (2). The companion is not told: what is sent
// to it doesn't change, so pausing costs the cache nothing.
import type { DatabaseSync } from "node:sqlite";

/** Off the record: written while paused and waiting for your choice, or left out for good. */
export const PAUSED = 1;
export const LEFT_OUT = 2;

/** The SQL value a new message or reason is written with, given its chat's id: 1 while paused. */
export const OFF_RECORD_NOW = "(SELECT memory_paused FROM chats WHERE id = ?)";

/** The messages of a chat the memory model must not read. */
export function heldBack(db: DatabaseSync, chatId: string): Set<number> {
  const rows = db.prepare("SELECT id FROM messages WHERE chat_id = ? AND off_record <> 0").all(chatId) as {
    id: number;
  }[];
  return new Set(rows.map((row) => row.id));
}

/** Of these messages, the ones written while paused, and the ones left out for good. */
export function offRecordAmong(
  db: DatabaseSync,
  chatId: string,
  ids: number[],
): { paused: number[]; leftOut: number[] } {
  const rows = db.prepare("SELECT id, off_record FROM messages WHERE chat_id = ? AND off_record <> 0").all(chatId) as {
    id: number;
    off_record: number;
  }[];
  const wanted = new Set(ids);
  const shown = rows.filter((row) => wanted.has(row.id));
  return {
    paused: shown.filter((row) => row.off_record === PAUSED).map((row) => row.id),
    leftOut: shown.filter((row) => row.off_record === LEFT_OUT).map((row) => row.id),
  };
}

export function pause(db: DatabaseSync, chatId: string): void {
  db.prepare("UPDATE chats SET memory_paused = 1 WHERE id = ?").run(chatId);
}

/**
 * Resumes memory in a chat. What was written while paused is filed as usual from the next run
 * (`keep`), or never (left out). Returns how many messages that was.
 */
export function resume(db: DatabaseSync, chatId: string, keep: boolean): number {
  const to = keep ? 0 : LEFT_OUT;
  const { changes } = db
    .prepare("UPDATE messages SET off_record = ? WHERE chat_id = ? AND off_record = ?")
    .run(to, chatId, PAUSED);
  db.prepare("UPDATE swipe_feedback SET off_record = ? WHERE chat_id = ? AND off_record = ?").run(to, chatId, PAUSED);
  db.prepare("UPDATE chats SET memory_paused = 0 WHERE id = ?").run(chatId);
  return Number(changes);
}
