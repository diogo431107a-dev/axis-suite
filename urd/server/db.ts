import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// systemd sets STATE_DIRECTORY (/var/lib/urd), keeping the sessions outside the app and private
// to the service; locally it falls back to ./data.
export const DB_FILE = join(process.env.STATE_DIRECTORY ?? "data", "urd.db");

// Each entry upgrades the schema by one version; PRAGMA user_version records how far we got.
// Add new steps to the end, never edit old ones.
const migrations: ((db: DatabaseSync) => void)[] = [
  // v1: projects, their estimates, sessions and their tags. Times that are summed are whole
  // seconds since 1970 (INTEGER), so a total is a plain sum.
  (db) => {
    db.exec(`
      CREATE TABLE projects (
        id          TEXT PRIMARY KEY,
        owner       TEXT NOT NULL,                    -- Heimdall username
        name        TEXT NOT NULL,
        estimate_s  INTEGER,                          -- seconds; NULL = no estimate
        archived_at TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE UNIQUE INDEX projects_owner_name ON projects (owner, name COLLATE NOCASE);
      CREATE TABLE estimate_changes (
        id         INTEGER PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        at         INTEGER NOT NULL,
        from_s     INTEGER,
        to_s       INTEGER
      );
      CREATE INDEX estimate_changes_project ON estimate_changes (project_id, id);
      CREATE TABLE sessions (
        id         TEXT PRIMARY KEY,
        owner      TEXT NOT NULL,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        started_at INTEGER NOT NULL,
        ended_at   INTEGER,                           -- NULL while it runs
        cutoff_at  INTEGER NOT NULL,                  -- when it stops by itself (see shared/cutoff.ts)
        zone       TEXT NOT NULL,                     -- IANA zone it was started in
        day        TEXT NOT NULL,                     -- YYYY-MM-DD it started there: its time counts for it
        stop       TEXT CHECK (stop IN ('manual', 'auto')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX sessions_owner_day ON sessions (owner, day);
      CREATE INDEX sessions_project_day ON sessions (project_id, day);
      -- At most one running session per user.
      CREATE UNIQUE INDEX sessions_running ON sessions (owner) WHERE ended_at IS NULL;
      CREATE TABLE session_tags (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        position   INTEGER NOT NULL,
        tag        TEXT NOT NULL,                     -- lower case, without #
        PRIMARY KEY (session_id, tag)
      ) WITHOUT ROWID;
    `);
  },
];

/** Opens (creating if needed) the database at `file`, or ":memory:", at the latest schema. */
export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  // Overwrite deleted rows with zeros instead of leaving them in free pages. The journal mode stays
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
