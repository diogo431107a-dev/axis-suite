// Everything Valhalla 2 keeps, in one SQLite file.
//
//   <STATE_DIRECTORY>/valhalla2.db      (/var/lib/valhalla2 on a server, ./data in development)
//
// Rows belong to a Heimdall username (`companions.owner`); everything else hangs off a companion,
// so deleting one person's companions takes all of theirs with them.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/** Where everything is kept: /var/lib/valhalla2 on a server, ./data in development. */
export const STATE_DIR = process.env.STATE_DIRECTORY ?? "data";
export const DB_FILE = join(STATE_DIR, "valhalla2.db");

// Each entry upgrades the schema by one version; PRAGMA user_version records how far we got.
// Add new steps to the end, never edit old ones.
const migrations: ((db: DatabaseSync) => void)[] = [
  // v1: companions, chats as trees of messages, edits kept, and why replies were rejected.
  (db) => {
    db.exec(`
      CREATE TABLE companions (
        id         TEXT PRIMARY KEY,
        owner      TEXT NOT NULL,                     -- Heimdall username
        name       TEXT NOT NULL,
        profile    TEXT NOT NULL,                     -- sent exactly as written
        settings   TEXT NOT NULL,                     -- JSON: Settings
        prompts    TEXT NOT NULL DEFAULT '{}',        -- JSON: Prompts; a missing key uses the default
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX companions_owner ON companions (owner, name);

      CREATE TABLE chats (
        id               TEXT PRIMARY KEY,
        companion_id     TEXT NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
        title            TEXT NOT NULL,
        mode             TEXT NOT NULL DEFAULT 'canon' CHECK (mode IN ('canon', 'one-shot')),
        active_leaf_id   INTEGER,                     -- end of the selected path; NULL = empty
        created_at       TEXT NOT NULL,
        last_activity_at TEXT NOT NULL
      );
      CREATE INDEX chats_companion ON chats (companion_id, last_activity_at);

      -- A tree: messages under one parent are swipes (assistant) or branches (user). Nothing the
      -- user hasn't deleted is ever removed, and a delete only stamps deleted_at.
      CREATE TABLE messages (
        id               INTEGER PRIMARY KEY,
        chat_id          TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        parent_id        INTEGER REFERENCES messages(id) ON DELETE CASCADE,
        role             TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content          TEXT NOT NULL,              -- JSON: the content blocks, verbatim
        instruction      TEXT,                       -- hidden instruction the reply was written under
        is_greeting      INTEGER NOT NULL DEFAULT 0,
        reply            TEXT,                       -- JSON: ReplyDetails, assistant messages only
        created_at       TEXT NOT NULL,
        edited_at        TEXT,
        deleted_at       TEXT,
        consolidated_at  TEXT,                       -- folded into the companion's memory
        needs_correction INTEGER NOT NULL DEFAULT 0  -- changed or left behind after that
      );
      CREATE INDEX messages_chat_parent ON messages (chat_id, parent_id);

      CREATE TABLE message_revisions (
        id          INTEGER PRIMARY KEY,
        message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        content     TEXT NOT NULL,                   -- JSON: the blocks before the edit
        replaced_at TEXT NOT NULL
      );
      CREATE INDEX message_revisions_message ON message_revisions (message_id, id);

      -- One row per message the user was asked about; reason NULL = skipped.
      CREATE TABLE swipe_feedback (
        id              INTEGER PRIMARY KEY,
        chat_id         TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        parent_id       INTEGER REFERENCES messages(id) ON DELETE CASCADE,  -- NULL: the greeting
        reason          TEXT,
        consolidated_at TEXT,
        created_at      TEXT NOT NULL
      );
      CREATE UNIQUE INDEX swipe_feedback_once ON swipe_feedback (chat_id, ifnull(parent_id, 0));
    `);
  },
];

/**
 * Opens (creating if needed) the database at `file`, or ":memory:", at the latest schema; or, for
 * the tests of a migration, at an older `version`.
 */
export function openDatabase(file: string = DB_FILE, version = migrations.length): DatabaseSync {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  // Overwrite deleted rows with zeros instead of leaving them in free pages. The journal mode stays
  // the default: one file, nothing beside it to forget in a backup.
  db.exec("PRAGMA secure_delete = ON");

  const { user_version: current } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = current; v < version; v++) {
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

const depths = new WeakMap<DatabaseSync, number>();

/**
 * Runs `work` as one transaction: all of it lands, or none of it does. Safe to nest — an inner
 * call becomes a savepoint of the outer one.
 */
export function transaction<T>(db: DatabaseSync, work: () => T): T {
  const depth = depths.get(db) ?? 0;
  const name = `step${depth}`;
  depths.set(db, depth + 1);
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = work();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (err) {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    throw err;
  } finally {
    depths.set(db, depth);
  }
}

/**
 * Deletes everything of everyone no longer in Heimdall, and says whose went. Called at startup
 * with knownUsers(); never called when the list is unknown.
 */
export function removeUnknownOwners(db: DatabaseSync, known: ReadonlySet<string>): string[] {
  const owners = (db.prepare("SELECT DISTINCT owner FROM companions ORDER BY owner").all() as { owner: string }[])
    .map((row) => row.owner)
    .filter((owner) => !known.has(owner));
  const remove = db.prepare("DELETE FROM companions WHERE owner = ?");
  transaction(db, () => {
    for (const owner of owners) remove.run(owner);
  });
  return owners;
}
