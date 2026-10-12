import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// systemd sets STATE_DIRECTORY (/var/lib/loggbok), keeping notes outside the app and private
// to the service; locally it falls back to ./data.
const STATE_DIR = process.env.STATE_DIRECTORY ?? "data";
const DB_FILE = join(STATE_DIR, "notes.db");

mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
export const db = new DatabaseSync(DB_FILE);
console.log(`Notes database: ${DB_FILE}`);

db.exec("PRAGMA foreign_keys = ON");

// Each entry upgrades the schema by one version; PRAGMA user_version records how far we got.
// Add new steps to the end, never edit old ones.
const migrations: (() => void)[] = [
  // v1: notes, each owned by a Heimdall user.
  () => {
    db.exec(`
      CREATE TABLE notes (
        id         TEXT PRIMARY KEY,
        owner      TEXT NOT NULL,  -- Heimdall username
        title      TEXT NOT NULL DEFAULT '',
        content    TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX notes_owner_updated ON notes (owner, updated_at DESC);
    `);
  },
  // v2: the people a note is shared with. Deleting a note deletes its shares.
  () => {
    db.exec(`
      CREATE TABLE note_shares (
        note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        username   TEXT NOT NULL,  -- Heimdall username of the person it's shared with
        permission TEXT NOT NULL CHECK (permission IN ('read', 'write')),
        PRIMARY KEY (note_id, username)
      );
      CREATE INDEX note_shares_username ON note_shares (username);
    `);
  },
];

const { user_version: current } = db.prepare("PRAGMA user_version").get() as { user_version: number };
for (let v = current; v < migrations.length; v++) {
  db.exec("BEGIN");
  try {
    migrations[v]!();
    db.exec(`PRAGMA user_version = ${v + 1}`);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
