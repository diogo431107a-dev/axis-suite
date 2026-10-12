import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// systemd sets STATE_DIRECTORY (/var/lib/vinr), keeping the contacts outside the app and private
// to the service; locally it falls back to ./data.
export const DB_FILE = join(process.env.STATE_DIRECTORY ?? "data", "vinr.db");

// Each entry upgrades the schema by one version; PRAGMA user_version records how far we got.
// Add new steps to the end, never edit old ones.
const migrations: ((db: DatabaseSync) => void)[] = [
  // v1: contacts, groups and who is in them, settings.
  (db) => {
    db.exec(`
      CREATE TABLE contacts (
        id         TEXT PRIMARY KEY,
        owner      TEXT NOT NULL,                     -- Heimdall username
        first_name TEXT NOT NULL,
        last_name  TEXT NOT NULL,
        nickname   TEXT NOT NULL,
        company    TEXT NOT NULL,
        title      TEXT NOT NULL,
        birthday   TEXT,                              -- YYYY-MM-DD, or --MM-DD without the year
        phones     TEXT NOT NULL,                     -- JSON Phone[], the primary one first
        emails     TEXT NOT NULL,                     -- JSON Email[]
        addresses  TEXT NOT NULL,                     -- JSON Address[]
        websites   TEXT NOT NULL,                     -- JSON Website[]
        dates      TEXT NOT NULL,                     -- JSON ContactDate[]
        memo       TEXT NOT NULL,
        favorite   INTEGER NOT NULL DEFAULT 0,
        search     TEXT NOT NULL,                     -- everything, lower case without accents (shared/contact.ts)
        rev        INTEGER NOT NULL,                  -- from meta 'rev': never the same twice
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT                               -- in the recycle bin since
      );
      CREATE INDEX contacts_owner ON contacts (owner, deleted_at);
      CREATE TABLE groups (
        id         TEXT PRIMARY KEY,
        owner      TEXT NOT NULL,
        name       TEXT NOT NULL,                     -- unique per owner, ignoring case (checked in store.ts)
        color      TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX groups_owner ON groups (owner);
      CREATE TABLE contact_groups (
        contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        PRIMARY KEY (contact_id, group_id)
      ) WITHOUT ROWID;
      CREATE INDEX contact_groups_group ON contact_groups (group_id);
      CREATE TABLE settings (
        owner TEXT PRIMARY KEY,
        data  TEXT NOT NULL                           -- JSON Settings
      );
      -- 'rev': the last revision given to a contact.
      CREATE TABLE meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
      INSERT INTO meta (key, value) VALUES ('rev', 0);
    `);
  },
];

/** Opens (creating if needed) the database at `file`, or ":memory:", at the latest schema. */
export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  // Overwrite deleted contacts with zeros instead of leaving them in free pages. The journal mode
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
