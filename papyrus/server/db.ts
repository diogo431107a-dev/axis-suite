import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// systemd sets STATE_DIRECTORY (/var/lib/papyrus), keeping the journals outside the app and
// private to the service; locally it falls back to ./data.
export const DB_FILE = join(process.env.STATE_DIRECTORY ?? "data", "papyrus.db");

// Each entry upgrades the schema by one version; PRAGMA user_version records how far we got.
// Add new steps to the end, never edit old ones.
const migrations: ((db: DatabaseSync) => void)[] = [
  // v1: journals, their pages (one per day), the tags in each page, templates and settings.
  (db) => {
    db.exec(`
      CREATE TABLE templates (
        id         TEXT PRIMARY KEY,
        owner      TEXT NOT NULL,                     -- Heimdall username
        name       TEXT NOT NULL,
        text       TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX templates_owner ON templates (owner);
      CREATE TABLE journals (
        id          TEXT PRIMARY KEY,
        owner       TEXT NOT NULL,
        name        TEXT NOT NULL,                    -- unique per owner outside the bin (checked in journal.ts)
        color       TEXT NOT NULL,
        template_id TEXT REFERENCES templates(id) ON DELETE SET NULL,
        position    INTEGER NOT NULL,                 -- order in the sidebar
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        deleted_at  TEXT                              -- in the recycle bin since, pages and all
      );
      CREATE INDEX journals_owner ON journals (owner);
      CREATE TABLE pages (
        id         INTEGER PRIMARY KEY,
        owner      TEXT NOT NULL,
        journal_id TEXT NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
        date       TEXT NOT NULL,                     -- YYYY-MM-DD
        text       TEXT NOT NULL,
        search     TEXT NOT NULL,                     -- text in lower case without accents, for search
        mood       INTEGER CHECK (mood BETWEEN 1 AND 5),
        words      INTEGER NOT NULL,
        rev        INTEGER NOT NULL,                  -- from meta 'rev': never the same twice
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (journal_id, date)
      );
      CREATE INDEX pages_owner_date ON pages (owner, date);
      CREATE TABLE page_tags (
        page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        tag     TEXT NOT NULL,                        -- lower case, NFC, without the #
        PRIMARY KEY (page_id, tag)
      ) WITHOUT ROWID;
      CREATE TABLE settings (
        owner TEXT PRIMARY KEY,
        data  TEXT NOT NULL                           -- JSON Settings
      );
      -- 'rev': the last revision given to a page.
      CREATE TABLE meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
      INSERT INTO meta (key, value) VALUES ('rev', 0);
      -- The pages people see: the ones of journals outside the recycle bin.
      CREATE VIEW live_pages AS
        SELECT p.* FROM pages p JOIN journals j ON j.id = p.journal_id WHERE j.deleted_at IS NULL;
    `);
  },
];

/** Opens (creating if needed) the database at `file`, or ":memory:", at the latest schema. */
export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  // Overwrite deleted text with zeros instead of leaving it in free pages. The journal mode stays
  // the default: one file, nothing beside it to forget in a backup.
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
