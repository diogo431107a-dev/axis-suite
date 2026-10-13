import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// systemd sets STATE_DIRECTORY (/var/lib/althing), keeping the messages outside the app and
// private to the service; locally it falls back to ./data.
export const DB_FILE = join(process.env.STATE_DIRECTORY ?? "data", "althing.db");

// Each entry upgrades the schema by one version; PRAGMA user_version records how far we got.
// Add new steps to the end, never edit old ones.
//
// The database is a record: messages, rooms (closed ones too), who was in a room when, and every
// nickname anyone has had. Nothing in it is ever deleted, except a removed user's profile, and
// their username, which is set to NULL wherever it appears (see removeUnknownOwners in store.ts).
// Times are ISO 8601 in UTC, e.g. 2026-10-13T18:04:59.123Z.
const migrations: ((db: DatabaseSync) => void)[] = [
  // v1
  (db) => {
    db.exec(`
      CREATE TABLE profiles (
        username   TEXT PRIMARY KEY,                     -- Heimdall username
        nickname   TEXT NOT NULL UNIQUE COLLATE NOCASE,
        about      TEXT NOT NULL DEFAULT '',
        avatar     TEXT NOT NULL,                        -- a file in /avatars/
        welcomed   INTEGER NOT NULL DEFAULT 0,           -- has seen the welcome and its rules
        created_at TEXT NOT NULL
      );
      -- Every nickname a user has had, from when. The first is their username.
      CREATE TABLE nicknames (
        username TEXT NOT NULL,
        nickname TEXT NOT NULL,
        from_at  TEXT NOT NULL
      );
      CREATE INDEX nicknames_user ON nicknames (username, from_at);

      -- Room 1 is the lobby, which never closes. A closed room stays here with its messages; a
      -- new room may then take its name.
      CREATE TABLE rooms (
        id         INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        created_by TEXT,                                 -- NULL: the lobby, or a removed user
        created_at TEXT NOT NULL,
        closed_at  TEXT
      );
      CREATE UNIQUE INDEX rooms_open_name ON rooms (name COLLATE NOCASE) WHERE closed_at IS NULL;
      -- Each time someone joins a room, and when they left it. Who is in it now: left_at IS NULL.
      CREATE TABLE room_visits (
        id        INTEGER PRIMARY KEY,
        room_id   INTEGER NOT NULL REFERENCES rooms(id),
        username  TEXT,                                  -- NULL: a removed user
        joined_at TEXT NOT NULL,
        left_at   TEXT
      );
      CREATE INDEX room_visits_open ON room_visits (room_id) WHERE left_at IS NULL;
      CREATE INDEX room_visits_user ON room_visits (username);

      -- One row per pair of people who have written to each other, user_a < user_b.
      CREATE TABLE dms (
        id         INTEGER PRIMARY KEY,
        user_a     TEXT,                                 -- NULL: a removed user
        user_b     TEXT,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX dms_pair ON dms (user_a, user_b);
      CREATE INDEX dms_b ON dms (user_b);

      CREATE TABLE messages (
        id         INTEGER PRIMARY KEY,
        room_id    INTEGER REFERENCES rooms(id),
        dm_id      INTEGER REFERENCES dms(id),
        author     TEXT,                                 -- NULL: a removed user
        body       TEXT NOT NULL,
        created_at TEXT NOT NULL,
        CHECK ((room_id IS NULL) <> (dm_id IS NULL))
      );
      CREATE INDEX messages_room ON messages (room_id, id) WHERE room_id IS NOT NULL;
      CREATE INDEX messages_dm ON messages (dm_id, id) WHERE dm_id IS NOT NULL;
      CREATE INDEX messages_author ON messages (author);

      -- What is on record stays: no message, room or visit can be deleted, and a message can't be
      -- changed, except that its author can become NULL.
      CREATE TRIGGER messages_kept BEFORE DELETE ON messages
        BEGIN SELECT RAISE(ABORT, 'Messages are on record and cannot be deleted'); END;
      CREATE TRIGGER messages_unchanged BEFORE UPDATE ON messages
        WHEN NEW.body IS NOT OLD.body OR NEW.room_id IS NOT OLD.room_id OR NEW.dm_id IS NOT OLD.dm_id
          OR NEW.created_at IS NOT OLD.created_at OR NEW.author IS NOT NULL
        BEGIN SELECT RAISE(ABORT, 'Messages are on record and cannot be changed'); END;
      CREATE TRIGGER rooms_kept BEFORE DELETE ON rooms
        BEGIN SELECT RAISE(ABORT, 'Rooms are on record and cannot be deleted'); END;
      CREATE TRIGGER room_visits_kept BEFORE DELETE ON room_visits
        BEGIN SELECT RAISE(ABORT, 'Room visits are on record and cannot be deleted'); END;

      -- The last message each person has seen in a conversation ('r<id>' or 'd<id>'), for their
      -- own unread counts. Nobody else sees these.
      CREATE TABLE reads (
        owner   TEXT NOT NULL,
        conv    TEXT NOT NULL,
        last_id INTEGER NOT NULL,
        PRIMARY KEY (owner, conv)
      ) WITHOUT ROWID;
    `);
    db.prepare("INSERT INTO rooms (id, name, created_by, created_at) VALUES (1, 'Lobby', NULL, ?)").run(
      new Date().toISOString(),
    );
  },
];

/** Opens (creating if needed) the database at `file`, or ":memory:", at the latest schema. */
export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  // Overwrite a removed user's profile with zeros instead of leaving it in free pages. The journal
  // mode stays the default: one file, nothing beside it to forget in a backup.
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
