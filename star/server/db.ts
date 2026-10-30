import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// systemd sets STATE_DIRECTORY (/var/lib/star), keeping the skies outside the app and private to
// the service; locally it falls back to ./data.
export const DB_FILE = join(process.env.STATE_DIRECTORY ?? "data", "star.db");

// Each entry upgrades the schema by one version; PRAGMA user_version records how far we got.
// Add new steps to the end, never edit old ones.
const migrations: ((db: DatabaseSync) => void)[] = [
  // v1: stars, the connections between them, and each user's revision.
  (db) => {
    db.exec(`
      CREATE TABLE skies (
        owner      TEXT PRIMARY KEY,                 -- Heimdall username
        rev        INTEGER NOT NULL DEFAULT 0,       -- raised by every batch that changes something
        last_batch TEXT                              -- the batch applied last, in case it is sent again
      );

      -- parent_id has no ON DELETE action on purpose: a branch is deleted in one statement.
      CREATE TABLE stars (
        id         TEXT PRIMARY KEY,                 -- made by the browser
        owner      TEXT NOT NULL,
        seq        INTEGER NOT NULL,                 -- creation order; the Greek letters follow it
        parent_id  TEXT REFERENCES stars(id),        -- NULL for a main star
        name       TEXT NOT NULL DEFAULT '',
        memo       TEXT NOT NULL DEFAULT '',
        relation   TEXT NOT NULL DEFAULT '',         -- what this star is to its parent
        hue        INTEGER NOT NULL DEFAULT 0,
        x          REAL NOT NULL,
        y          REAL NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX stars_owner ON stars (owner, seq);
      CREATE INDEX stars_parent ON stars (parent_id);

      -- "b is a's relation". The same two stars can be connected only once, either way round.
      CREATE TABLE links (
        id         TEXT PRIMARY KEY,                 -- made by the browser
        owner      TEXT NOT NULL,
        a_id       TEXT NOT NULL REFERENCES stars(id) ON DELETE CASCADE,
        b_id       TEXT NOT NULL REFERENCES stars(id) ON DELETE CASCADE,
        relation   TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX links_owner ON links (owner, created_at);
      CREATE INDEX links_a ON links (a_id);
      CREATE INDEX links_b ON links (b_id);
      CREATE UNIQUE INDEX links_pair ON links (min(a_id, b_id), max(a_id, b_id));
    `);
  },
];

/** Opens (creating if needed) the database at `file`, or ":memory:", at the latest schema. */
export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  // Overwrite deleted stars with zeros instead of leaving them in free pages. The journal mode
  // stays the default: one file, nothing beside it to forget in a backup.
  db.exec("PRAGMA secure_delete = ON");

  const { user_version: current } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = current; v < migrations.length; v++) {
    db.exec("BEGIN");
    try {
      migrations[v]!(db);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  return db;
}
