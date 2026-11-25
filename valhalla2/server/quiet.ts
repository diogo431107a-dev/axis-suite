// Topics a companion leaves alone: things you asked it not to bring up, such as an old arc it keeps
// returning to. They are sent in every chat with the companion, after its memory and pins
// (memory/inject.ts), so it doesn't raise them unless you do; and the memory model is shown them
// too, so it adds nothing about them and keeps what memory has on them brief.
//
// Adding or removing one clears the snapshot of every chat with the companion, so each takes a
// fresh look on its next turn: you asked it to stop, and it should stop now.
import type { DatabaseSync } from "node:sqlite";
import { LIMITS, type QuietTopic } from "../shared/protocol.ts";
import { object, required } from "./check.ts";
import type { Companions } from "./companions.ts";
import { notFound, tooMany } from "./errors.ts";

interface Row {
  id: number;
  text: string;
  created_at: string;
}

/** A companion's topics to leave alone, oldest first: the order they are sent in. */
export function quietOf(db: DatabaseSync, companionId: string): QuietTopic[] {
  const rows = db
    .prepare("SELECT id, text, created_at FROM quiet_topics WHERE companion_id = ? ORDER BY id")
    .all(companionId) as unknown as Row[];
  return rows.map((row) => ({ id: row.id, text: row.text, createdAt: row.created_at }));
}

/** The topics as the memory model reads them, or nothing when there are none. */
export function quietBlock(topics: QuietTopic[]): string[] {
  return topics.length > 0
    ? [`<leave_alone>\n${topics.map((topic) => `- ${topic.text}`).join("\n")}\n</leave_alone>`]
    : [];
}

/** Every chat with the companion takes a fresh look at memory, and so at these, on its next turn. */
const freshLook = (db: DatabaseSync, companionId: string) =>
  db.prepare("UPDATE chats SET memory_snapshot = NULL WHERE companion_id = ?").run(companionId);

/** One person's topics to leave alone. */
export function createQuiet(db: DatabaseSync, companions: Companions) {
  return {
    /** Adds a topic, `{ text }`, for one of this person's companions. */
    add(companionId: string, body: unknown, now = new Date().toISOString()): QuietTopic {
      const companion = companions.get(companionId);
      const text = required(object(body).text, LIMITS.quietText, "The topic");
      const { count } = db
        .prepare("SELECT count(*) AS count FROM quiet_topics WHERE companion_id = ?")
        .get(companion.id) as { count: number };
      if (count >= LIMITS.quiet) tooMany(`A companion leaves ${LIMITS.quiet} topics alone at most. Remove one first.`);
      const { id } = db
        .prepare("INSERT INTO quiet_topics (companion_id, text, created_at) VALUES (?, ?, ?) RETURNING id")
        .get(companion.id, text, now) as { id: number };
      freshLook(db, companion.id);
      return { id, text, createdAt: now };
    },

    /** Lets the companion bring a topic up again. */
    remove(companionId: string, topicId: number): void {
      const companion = companions.get(companionId);
      const gone = db.prepare("DELETE FROM quiet_topics WHERE id = ? AND companion_id = ?").run(topicId, companion.id);
      if (gone.changes === 0) notFound("topic");
      freshLook(db, companion.id);
    },
  };
}

export type Quiet = ReturnType<typeof createQuiet>;
