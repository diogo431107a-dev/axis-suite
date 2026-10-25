import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// systemd sets STATE_DIRECTORY (/var/lib/saga), keeping the players and their games outside the
// app and private to the service; locally it falls back to ./data.
export const STATE_DIR = process.env.STATE_DIRECTORY ?? "data";
export const DB_FILE = join(STATE_DIR, "saga.db");

// Each entry upgrades the schema by one version; PRAGMA user_version records how far we got.
// Add new steps to the end, never edit old ones.
const migrations: ((db: DatabaseSync) => void)[] = [
  // v1: players and their sessions, the invite codes that let them join, and one saved game each.
  // The game itself is a JSON blob, so changes to the game never need a migration here; the
  // numbers the ranking sorts by are copied out of it into columns on every save.
  (db) => {
    db.exec(`
      CREATE TABLE players (
        id                   INTEGER PRIMARY KEY,
        username             TEXT NOT NULL UNIQUE COLLATE NOCASE,  -- for signing in, never shown
        password_hash        TEXT NOT NULL,                        -- scrypt$salt$key
        must_change_password INTEGER NOT NULL DEFAULT 0,           -- 1 after the owner resets it
        hero_name            TEXT NOT NULL UNIQUE COLLATE NOCASE,  -- public, in the ranking
        avatar               TEXT NOT NULL,
        created_at           TEXT NOT NULL,
        last_seen_at         TEXT
      );
      CREATE TABLE sessions (
        token_hash   TEXT PRIMARY KEY,                             -- sha256 of the cookie's value
        player_id    INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        created_at   TEXT NOT NULL,
        last_used_at TEXT NOT NULL
      );
      CREATE INDEX sessions_player ON sessions (player_id);
      CREATE TABLE invites (
        code       TEXT PRIMARY KEY,                               -- SAGA-XXXX-XXXX, used once
        note       TEXT NOT NULL DEFAULT '',                       -- who it was for
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_by    INTEGER REFERENCES players(id) ON DELETE SET NULL,
        used_at    TEXT
      );
      CREATE TABLE saves (
        player_id    INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
        revision     INTEGER NOT NULL,                             -- +1 on every save
        game_version INTEGER NOT NULL,                             -- the game's state.v
        state        TEXT NOT NULL,                                -- the game as JSON
        updated_at   TEXT NOT NULL,
        level        INTEGER NOT NULL,
        fame         INTEGER NOT NULL,
        front_index  INTEGER NOT NULL,                             -- the furthest foe reached
        dragon_kills INTEGER NOT NULL,
        dragon_kinds INTEGER NOT NULL,
        loops        INTEGER NOT NULL,
        habit_count  INTEGER NOT NULL
      );
      CREATE INDEX saves_by_fame ON saves (fame DESC, level DESC);
      CREATE INDEX saves_by_level ON saves (level DESC, fame DESC);
    `);
  },
];

/** Opens (creating if needed) the database at `file` and brings its schema up to date. */
export function openDatabase(file: string = DB_FILE): DatabaseSync {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
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
