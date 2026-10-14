import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// systemd sets STATE_DIRECTORY (/var/lib/mimir), keeping the maps outside the app and private to
// the service; locally it falls back to ./data.
export const DB_FILE = join(process.env.STATE_DIRECTORY ?? "data", "mimir.db");

// Each entry upgrades the schema by one version; PRAGMA user_version records how far we got.
// Add new steps to the end, never edit old ones.
//
// Ranks are fractional indexes (fractional-indexing's keys, ASCII digits and letters), compared as
// plain text. Equal ranks are ordered by id.
const migrations: ((db: DatabaseSync) => void)[] = [
  // v1: maps, their nodes and their arrows.
  (db) => {
    db.exec(`
      CREATE TABLE maps (
        id         TEXT PRIMARY KEY,
        owner      TEXT NOT NULL,                    -- Heimdall username; nodes and arrows are the map's
        rank       TEXT NOT NULL,                    -- order in the sidebar
        rev        INTEGER NOT NULL DEFAULT 0,       -- raised by every batch of ops that changes something
        purged_rev INTEGER NOT NULL DEFAULT 0,       -- the rev of the last purge: older pages reload
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX maps_owner ON maps (owner, rank);

      -- parent_id has no ON DELETE action on purpose: SQLite runs foreign-key actions as triggers,
      -- nested at most 1000 deep, so a cascade down a deep branch would fail. A map's nodes go with
      -- the map (one level, through map_id); a purge deletes whole branches in one statement.
      CREATE TABLE nodes (
        id         TEXT PRIMARY KEY,                 -- made by the browser
        map_id     TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        parent_id  TEXT REFERENCES nodes(id),        -- NULL only for the root
        rank       TEXT NOT NULL,
        side       TEXT CHECK (side IN ('left', 'right')),  -- set only on the root's children
        text       TEXT NOT NULL DEFAULT '',
        collapsed  INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT,                             -- soft delete; hides the whole branch
        rev        INTEGER NOT NULL,                 -- the map's rev when it last changed
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX nodes_root ON nodes (map_id) WHERE parent_id IS NULL;
      CREATE INDEX nodes_map ON nodes (map_id, rev);
      CREATE INDEX nodes_parent ON nodes (parent_id, rank);

      CREATE TABLE arrows (
        id         TEXT PRIMARY KEY,                 -- made by the browser
        map_id     TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        from_id    TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        to_id      TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        label      TEXT NOT NULL DEFAULT '',
        deleted_at TEXT,
        rev        INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX arrows_map ON arrows (map_id, rev);
      CREATE INDEX arrows_from ON arrows (from_id);
      CREATE INDEX arrows_to ON arrows (to_id);
    `);
  },
];

/** Opens (creating if needed) the database at `file`, or ":memory:", at the latest schema. */
export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  // Overwrite deleted nodes with zeros instead of leaving them in free pages. The journal mode
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
