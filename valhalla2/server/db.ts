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
  // v2: the companion's memory. Its files, every change to them, every run of the memory model
  // and every command it made. A file belongs to a "space": a companion's id, or `scratch:<run>`
  // while a run works on a copy (see memory/store.ts), which is why there is no foreign key.
  (db) => {
    db.exec(`
      CREATE TABLE memory_files (
        space      TEXT NOT NULL,                     -- a companion's id, or scratch:<run id>
        path       TEXT NOT NULL,                     -- relative to /memories: 'story/recent.md'
        content    TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (space, path)
      ) WITHOUT ROWID;

      CREATE TABLE memory_versions (
        id         INTEGER PRIMARY KEY,
        space      TEXT NOT NULL,
        path       TEXT NOT NULL,
        content    TEXT,                              -- after the change; NULL when it deleted the file
        op         TEXT NOT NULL,                     -- seed, create, str_replace, insert, delete, rename,
                                                      -- manual_edit, revert, cleanup, rebuild
        source     TEXT NOT NULL,                     -- consolidate:<chat id>, cleanup, manual, rebuild, seed
        run_id     INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE INDEX memory_versions_file ON memory_versions (space, path, id);

      CREATE TABLE memory_runs (
        id          INTEGER PRIMARY KEY,
        space       TEXT NOT NULL,                    -- the companion
        chat_id     TEXT,
        kind        TEXT NOT NULL,                    -- consolidate, cleanup, rebuild
        model       TEXT NOT NULL,
        attempts    TEXT,                             -- JSON: Attempt[], every request of the run
        ok          INTEGER,                          -- NULL while it runs
        error       TEXT,
        summary     TEXT,                             -- what the model said it changed
        started_at  TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE INDEX memory_runs_space ON memory_runs (space, id);

      -- Every memory command the model made, for debugging. Never sent to the model again.
      CREATE TABLE memory_ops (
        id         INTEGER PRIMARY KEY,
        run_id     INTEGER,
        space      TEXT NOT NULL,
        chat_id    TEXT,
        command    TEXT NOT NULL,
        path       TEXT,
        ok         INTEGER NOT NULL,
        error      TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX memory_ops_run ON memory_ops (run_id);

      -- A companion's memory goes with it.
      CREATE TRIGGER companions_memory_gone AFTER DELETE ON companions BEGIN
        DELETE FROM memory_files WHERE space = old.id;
        DELETE FROM memory_versions WHERE space = old.id;
        DELETE FROM memory_ops WHERE space = old.id;
        DELETE FROM memory_runs WHERE space = old.id;
      END;

      -- What a chat shows the model of memory, frozen so the prompt cache holds (see memory/inject.ts).
      ALTER TABLE chats ADD COLUMN memory_snapshot TEXT;
      -- The mode the chat's messages were last filed into memory under.
      ALTER TABLE chats ADD COLUMN consolidated_mode TEXT;
      -- The first message the model is still sent; older ones have slid out (see memory/history.ts).
      ALTER TABLE chats ADD COLUMN window_start INTEGER;
    `);
  },
  // v3: pictures of a companion. The image itself is a file in <STATE_DIRECTORY>/pictures, named
  // in `file`; the row says what it is, who it belongs to, and how it was made.
  (db) => {
    db.exec(`
      CREATE TABLE pictures (
        id              TEXT PRIMARY KEY,
        companion_id    TEXT NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
        kind            TEXT NOT NULL CHECK (kind IN ('profile', 'chat')),
        -- What a chat picture was made from. A deleted chat leaves its pictures in the gallery.
        chat_id         TEXT REFERENCES chats(id) ON DELETE SET NULL,
        message_id      INTEGER REFERENCES messages(id) ON DELETE SET NULL,
        prompt          TEXT NOT NULL,
        negative_prompt TEXT NOT NULL,
        orientation     TEXT NOT NULL,
        caption         TEXT NOT NULL,
        params          TEXT NOT NULL,                -- JSON: PictureParams
        status          TEXT NOT NULL DEFAULT 'working' CHECK (status IN ('working', 'done', 'failed')),
        workflow_id     TEXT,                         -- CivitAI's id for it, once asked for
        error           TEXT,
        file            TEXT,                         -- <id>.<png|jpg|webp>, once done
        bytes           INTEGER,
        created_at      TEXT NOT NULL,
        finished_at     TEXT
      );
      CREATE INDEX pictures_companion ON pictures (companion_id, created_at);
      CREATE INDEX pictures_message ON pictures (message_id);
      CREATE INDEX pictures_chat ON pictures (chat_id);
    `);
  },
  // v4: replies read aloud. The audio is a file in <STATE_DIRECTORY>/speech, named in `file`; the
  // row says which message it reads, in which voice, and from which text, so an edited reply or
  // another voice is read again. `speech_usage` adds up what Azure was asked to read each month.
  (db) => {
    db.exec(`
      CREATE TABLE speech (
        id         INTEGER PRIMARY KEY,
        message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        voice      TEXT NOT NULL,
        text_hash  TEXT NOT NULL,                     -- sha256 of the voice and the text read
        file       TEXT NOT NULL,                     -- <message id>-<hash>.mp3
        bytes      INTEGER NOT NULL,
        chars      INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX speech_once ON speech (message_id, voice, text_hash);

      CREATE TABLE speech_usage (
        month TEXT PRIMARY KEY,                       -- YYYY-MM, UTC
        chars INTEGER NOT NULL
      );
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
