import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// systemd sets STATE_DIRECTORY (/var/lib/chronos), keeping the calendars outside the app and
// private to the service; locally it falls back to ./data.
export const DB_FILE = join(process.env.STATE_DIRECTORY ?? "data", "chronos.db");

// Each entry upgrades the schema by one version; PRAGMA user_version records how far we got.
// Add new steps to the end, never edit old ones.
const migrations: ((db: DatabaseSync) => void)[] = [
  // v1: calendars, their events, settings.
  (db) => {
    db.exec(`
      CREATE TABLE calendars (
        id          TEXT PRIMARY KEY,
        owner       TEXT NOT NULL,                    -- Heimdall username
        name        TEXT NOT NULL,                    -- unique per owner, ignoring case (checked in store.ts)
        color       TEXT NOT NULL,
        visible     INTEGER NOT NULL DEFAULT 1,
        position    INTEGER NOT NULL,
        source_name TEXT,                             -- the .ics file it was last imported from
        imported_at TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX calendars_owner ON calendars (owner);
      CREATE TABLE events (
        id            TEXT PRIMARY KEY,
        owner         TEXT NOT NULL,
        calendar_id   TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
        uid           TEXT NOT NULL,                  -- iCalendar UID
        recurrence_id TEXT NOT NULL DEFAULT '',       -- an occurrence's original start, or ''
        origin        TEXT NOT NULL CHECK (origin IN ('user', 'import')),
        title         TEXT NOT NULL,
        all_day       INTEGER NOT NULL,
        start_at      TEXT,                           -- timed: instants in UTC, YYYY-MM-DDTHH:MM:SSZ
        end_at        TEXT,
        start_date    TEXT,                           -- all-day: YYYY-MM-DD, the end exclusive
        end_date      TEXT,
        source_zone   TEXT,                           -- the zone the file gave it
        location      TEXT NOT NULL,
        description   TEXT NOT NULL,
        url           TEXT NOT NULL,
        rev           INTEGER NOT NULL,               -- from meta 'rev': never the same twice
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        CHECK ((all_day = 0 AND start_at IS NOT NULL AND end_at IS NOT NULL AND start_date IS NULL AND end_date IS NULL)
            OR (all_day = 1 AND start_date IS NOT NULL AND end_date IS NOT NULL AND start_at IS NULL AND end_at IS NULL)),
        UNIQUE (calendar_id, uid, recurrence_id)
      );
      CREATE INDEX events_owner_start_at ON events (owner, start_at);
      CREATE INDEX events_owner_start_date ON events (owner, start_date);
      CREATE TABLE settings (
        owner TEXT PRIMARY KEY,
        data  TEXT NOT NULL                           -- JSON Settings
      );
      -- 'rev': the last revision given to an event.
      CREATE TABLE meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
      INSERT INTO meta (key, value) VALUES ('rev', 0);
    `);
  },
  // v2: the people a calendar is shared with. Each has their own colour for it and shows or hides
  // it for themselves. Deleting a calendar deletes its shares.
  (db) => {
    db.exec(`
      CREATE TABLE calendar_shares (
        calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
        username    TEXT NOT NULL,                    -- Heimdall username of the person it's shared with
        permission  TEXT NOT NULL CHECK (permission IN ('read', 'write')),
        color       TEXT NOT NULL,                    -- its colour for them
        visible     INTEGER NOT NULL DEFAULT 1,       -- shown for them
        PRIMARY KEY (calendar_id, username)
      );
      CREATE INDEX calendar_shares_username ON calendar_shares (username);
      -- The events of a user's own and shared calendars are found by calendar, not by owner.
      CREATE INDEX events_calendar_start_at ON events (calendar_id, start_at);
      CREATE INDEX events_calendar_start_date ON events (calendar_id, start_date);
    `);
  },
];

/** Opens (creating if needed) the database at `file`, or ":memory:", at the latest schema. */
export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  // Overwrite deleted events with zeros instead of leaving them in free pages. The journal mode
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
