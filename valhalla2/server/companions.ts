// The companions one person talks to.
//
// A companion is a name for the list, one profile text box the model reads as written (the user
// persona goes inside it), its settings, its own versions of Valhalla 2's prompt texts, and the
// voice its replies are read aloud in.
import type { DatabaseSync } from "node:sqlite";
import { LIMITS, type Companion, type Settings } from "../shared/protocol.ts";
import {
  object,
  prompts as checkPrompts,
  required,
  settings as checkSettings,
  text,
  voice as checkVoice,
} from "./check.ts";
import { config } from "./config.ts";
import { notFound, tooMany } from "./errors.ts";
import { createMemory } from "./memory/store.ts";

interface Row {
  id: string;
  name: string;
  profile: string;
  settings: string;
  prompts: string;
  voice: string | null;
  created_at: string;
  updated_at: string;
}

export const companionOf = (row: Row): Companion => ({
  id: row.id,
  name: row.name,
  profile: row.profile,
  settings: JSON.parse(row.settings) as Settings,
  prompts: JSON.parse(row.prompts) as Companion["prompts"],
  voice: row.voice,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const COLUMNS = "id, name, profile, settings, prompts, voice, created_at, updated_at";

/** One person's companions. `defaults` fills in settings a request leaves out. */
export function createCompanions(db: DatabaseSync, owner: string, defaults: Settings) {
  function get(id: string): Companion {
    const row = db.prepare(`SELECT ${COLUMNS} FROM companions WHERE id = ? AND owner = ?`).get(id, owner) as
      Row | undefined;
    return row ? companionOf(row) : notFound("companion");
  }

  return {
    get,

    list(): Companion[] {
      const rows = db
        .prepare(`SELECT ${COLUMNS} FROM companions WHERE owner = ? ORDER BY name COLLATE NOCASE`)
        .all(owner) as unknown as Row[];
      return rows.map(companionOf);
    },

    /** Saves a companion under this id, whether it is new or a change to one already there. */
    save(id: string, body: unknown): Companion {
      const fields = object(body);
      const name = required(fields.name, LIMITS.name, "The name");
      const profile = text(fields.profile ?? "", LIMITS.profile, "The profile");
      const settings = checkSettings(fields.settings, defaults);
      const prompts = checkPrompts(fields.prompts);
      const voice = checkVoice(fields.voice);
      const now = new Date().toISOString();

      const existing = db.prepare("SELECT owner FROM companions WHERE id = ?").get(id) as { owner: string } | undefined;
      if (existing && existing.owner !== owner) notFound("companion");
      if (existing) {
        db.prepare(
          "UPDATE companions SET name = ?, profile = ?, settings = ?, prompts = ?, voice = ?, updated_at = ? WHERE id = ?",
        ).run(name, profile, JSON.stringify(settings), JSON.stringify(prompts), voice, now, id);
      } else {
        const { count } = db.prepare("SELECT count(*) AS count FROM companions WHERE owner = ?").get(owner) as {
          count: number;
        };
        if (count >= LIMITS.companions) tooMany(`Valhalla 2 keeps ${LIMITS.companions} companions at most`);
        db.prepare(`INSERT INTO companions (${COLUMNS}, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          id,
          name,
          profile,
          JSON.stringify(settings),
          JSON.stringify(prompts),
          voice,
          now,
          now,
          owner,
        );
        // A new companion starts with its memory files laid out, empty but for what goes where.
        createMemory(db, config.memory).seed(id, now);
      }
      return get(id);
    },

    /** Deletes a companion with every chat it had. */
    remove(id: string): void {
      get(id);
      db.prepare("DELETE FROM companions WHERE id = ? AND owner = ?").run(id, owner);
    },
  };
}

export type Companions = ReturnType<typeof createCompanions>;
