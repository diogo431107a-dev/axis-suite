import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// systemd sets STATE_DIRECTORY (/var/lib/yggdrasil), keeping the tree outside the app and
// private to the service; locally it falls back to ./data.
export const DB_FILE = join(process.env.STATE_DIRECTORY ?? "data", "tree.db");

// Each entry upgrades the schema by one version; PRAGMA user_version records how far we got.
// Add new steps to the end, never edit old ones.
const migrations: ((db: DatabaseSync) => void)[] = [
  // v1: every user's bullets in one table, and the revision counter.
  (db) => {
    db.exec(`
      CREATE TABLE nodes (
        id           TEXT PRIMARY KEY,            -- made by the browser (creation is optimistic)
        owner        TEXT NOT NULL,               -- Heimdall username
        parent_id    TEXT REFERENCES nodes(id) ON DELETE CASCADE,   -- NULL = top level
        rank         TEXT NOT NULL,               -- fractional index among siblings
        content      TEXT NOT NULL DEFAULT '',    -- one line, inline markdown
        note         TEXT NOT NULL DEFAULT '',    -- multi-line
        completed_at TEXT,
        collapsed    INTEGER NOT NULL DEFAULT 0,  -- synced across devices, like Workflowy
        starred      INTEGER NOT NULL DEFAULT 0,
        deleted_at   TEXT,                        -- soft delete; hides the whole subtree
        rev          INTEGER NOT NULL,            -- revision of the last change to this row
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
      CREATE INDEX nodes_owner_rev ON nodes (owner, rev);
      CREATE INDEX nodes_parent    ON nodes (parent_id, rank);
      -- 'rev': the latest revision. 'purged_rev': the revision of the last purge.
      CREATE TABLE meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
      INSERT INTO meta (key, value) VALUES ('rev', 0), ('purged_rev', 0);
    `);
  },
  // v2: sharing. The people a bullet is shared with (everything under it comes along); each
  // one's own collapsed and starred for the bullets shared with them; and, per user, the latest
  // revision after which their pages must load the whole tree again (what they may see changed).
  (db) => {
    db.exec(`
      CREATE TABLE shares (
        node_id    TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        username   TEXT NOT NULL,                 -- Heimdall username of the person it's shared with
        permission TEXT NOT NULL CHECK (permission IN ('read', 'write')),
        PRIMARY KEY (node_id, username)
      );
      CREATE INDEX shares_username ON shares (username);
      CREATE TABLE node_views (
        node_id   TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        username  TEXT NOT NULL,                  -- someone the bullet is shared with
        collapsed INTEGER,                        -- NULL: as its owner has it
        starred   INTEGER NOT NULL DEFAULT 0,
        rev       INTEGER NOT NULL,
        PRIMARY KEY (node_id, username)
      );
      CREATE INDEX node_views_username_rev ON node_views (username, rev);
      CREATE TABLE resets (username TEXT PRIMARY KEY, rev INTEGER NOT NULL);
    `);
  },
];

/** Opens (creating if needed) the database at `file`, or ":memory:", at the latest schema. */
export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");

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
