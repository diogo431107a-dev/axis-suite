import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// systemd sets STATE_DIRECTORY (/var/lib/janus), keeping the vaults outside the app and private
// to the service; locally it falls back to ./data.
export const DB_FILE = join(process.env.STATE_DIRECTORY ?? "data", "janus.db");

// Each entry upgrades the schema by one version; PRAGMA user_version records how far we got.
// Add new steps to the end, never edit old ones.
const migrations: ((db: DatabaseSync) => void)[] = [
  // v1: groups and entries of every user. Only ids, owners, links and times are plain; whatever
  // people typed is in the sealed `data` and `totp` columns (see seal.ts).
  (db) => {
    db.exec(`
      CREATE TABLE groups (
        id         TEXT PRIMARY KEY,
        owner      TEXT NOT NULL,                   -- Heimdall username
        parent_id  TEXT REFERENCES groups(id),      -- NULL = top level; only empty groups are deleted
        data       BLOB NOT NULL,                   -- sealed { name }
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX groups_owner ON groups (owner);
      CREATE TABLE entries (
        id         TEXT PRIMARY KEY,
        owner      TEXT NOT NULL,
        group_id   TEXT REFERENCES groups(id),      -- NULL = top level
        data       BLOB NOT NULL,                   -- sealed { title, username, password, url, notes }
        totp       BLOB,                            -- sealed TotpParams, NULL = no TOTP
        rev        INTEGER NOT NULL DEFAULT 1,      -- +1 on every change, to detect edits made elsewhere
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT                             -- in the recycle bin since
      );
      CREATE INDEX entries_owner ON entries (owner);
      CREATE INDEX entries_group ON entries (group_id);
      -- 'key_check': a sealed constant, to notice a database opened with another key.
      CREATE TABLE meta (key TEXT PRIMARY KEY, value BLOB NOT NULL);
    `);
  },
];

/** Opens (creating if needed) the database at `file`, or ":memory:", at the latest schema. */
export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  // Overwrite deleted content with zeros instead of leaving it in free pages.
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
