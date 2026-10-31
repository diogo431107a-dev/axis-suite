import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// systemd sets STATE_DIRECTORY (/var/lib/tyr), keeping the files outside the app and private to the
// service; locally it falls back to ./data.
export const DB_FILE = join(process.env.STATE_DIRECTORY ?? "data", "tyr.db");

// Each entry upgrades the schema by one version; PRAGMA user_version records how far we got.
// Add new steps to the end, never edit old ones.
const migrations: ((db: DatabaseSync) => void)[] = [
  // v1: the drawer, its files, the places and the entries, and the profile answers.
  (db) => {
    db.exec(`
      CREATE TABLE drawers (
        owner      TEXT PRIMARY KEY,                 -- Heimdall username
        next_no    INTEGER NOT NULL,                 -- a file's number is never used twice
        created_at TEXT NOT NULL
      );

      CREATE TABLE people (
        id          TEXT PRIMARY KEY,                -- made by the browser
        owner       TEXT NOT NULL,
        no          INTEGER NOT NULL,
        name        TEXT NOT NULL,
        name_key    TEXT NOT NULL,                   -- the name without accents or case
        aliases     TEXT NOT NULL DEFAULT '[]',      -- JSON array of strings
        role        TEXT NOT NULL DEFAULT '',
        matters     TEXT NOT NULL DEFAULT '[]',      -- JSON array of strings
        opened_on   TEXT NOT NULL,                   -- the user's calendar day
        closed_on   TEXT,
        close_note  TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        UNIQUE (owner, name_key),
        UNIQUE (owner, no)
      );

      -- Labels, never addresses.
      CREATE TABLE places (
        id        TEXT PRIMARY KEY,
        owner     TEXT NOT NULL,
        label     TEXT NOT NULL,
        label_key TEXT NOT NULL,
        city      TEXT NOT NULL DEFAULT '',
        UNIQUE (owner, label_key)
      );

      -- Dates and times are stored as they were typed, with their precision: see Stamp in
      -- shared/protocol.ts. They are the user's own and never converted.
      CREATE TABLE entries (
        id           TEXT PRIMARY KEY,               -- made by the browser
        owner        TEXT NOT NULL,
        person_id    TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        logged_at    TEXT NOT NULL,                  -- an instant, UTC. Set once; see the trigger
        told_date    TEXT NOT NULL,
        told_time    TEXT,
        told_prec    TEXT NOT NULL,
        hap_date     TEXT NOT NULL,
        hap_time     TEXT,
        hap_prec     TEXT NOT NULL,
        place_id     TEXT REFERENCES places(id),
        setting      TEXT,                           -- private, group
        source       TEXT NOT NULL CHECK (source IN ('U', 'I', 'P', 'O', 'N')),
        wording      TEXT NOT NULL,                  -- para, quote
        body         TEXT NOT NULL,
        category     TEXT,
        certainty    TEXT NOT NULL,                  -- sure, fair, fuzzy
        conf         INTEGER NOT NULL DEFAULT 0,     -- they asked me not to repeat it
        present      TEXT NOT NULL DEFAULT '[]',     -- JSON array of names
        context      TEXT NOT NULL DEFAULT '',
        fu_date      TEXT,
        fu_note      TEXT NOT NULL DEFAULT '',
        fu_done_on   TEXT,
        amends_id    TEXT REFERENCES entries(id) ON DELETE SET NULL,
        contra_id    TEXT REFERENCES entries(id) ON DELETE SET NULL,
        incomplete   INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX entries_owner ON entries (owner, logged_at);
      CREATE INDEX entries_person ON entries (person_id);
      CREATE INDEX entries_place ON entries (place_id);

      CREATE TRIGGER entries_logged_at_is_fixed BEFORE UPDATE OF logged_at ON entries
      WHEN NEW.logged_at <> OLD.logged_at
      BEGIN
        SELECT RAISE(ABORT, 'An entry''s logged-at never changes');
      END;

      -- Only ever added to: each revision of an answer is a new row, and the latest is the answer.
      CREATE TABLE answers (
        seq        INTEGER PRIMARY KEY,
        id         TEXT NOT NULL UNIQUE,             -- made by the browser
        owner      TEXT NOT NULL,
        person_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        question   TEXT NOT NULL,
        text       TEXT NOT NULL,
        revised_on TEXT NOT NULL,                    -- the user's calendar day
        created_at TEXT NOT NULL
      );
      CREATE INDEX answers_person ON answers (person_id, question);

      CREATE TABLE answer_evidence (
        answer_seq INTEGER NOT NULL REFERENCES answers(seq) ON DELETE CASCADE,
        entry_id   TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        PRIMARY KEY (answer_seq, entry_id)
      ) WITHOUT ROWID;
      CREATE INDEX answer_evidence_entry ON answer_evidence (entry_id);
    `);
  },
  // v2: care and trust. Only additions: every entry stays as it was.
  (db) => {
    db.exec(`
      CREATE TABLE incidents (
        id         TEXT PRIMARY KEY,                 -- made by the browser
        owner      TEXT NOT NULL,
        title      TEXT NOT NULL,
        status     TEXT NOT NULL,                    -- rumour, one, confirmed, disproved
        mentions   TEXT NOT NULL DEFAULT '[]',       -- JSON array: people with no file
        opened_on  TEXT NOT NULL,
        closed_on  TEXT,
        close_note TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX incidents_owner ON incidents (owner);

      CREATE TABLE incident_people (
        incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
        person_id   TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        PRIMARY KEY (incident_id, person_id)
      ) WITHOUT ROWID;
      CREATE INDEX incident_people_person ON incident_people (person_id);

      -- Only ever added to: what was known, and from when.
      CREATE TABLE incident_status (
        seq         INTEGER PRIMARY KEY,
        incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
        on_date     TEXT NOT NULL,
        status      TEXT NOT NULL
      );
      CREATE INDEX incident_status_incident ON incident_status (incident_id);

      -- Hearsay inside an incident. Never changed.
      CREATE TABLE incident_notes (
        id          TEXT PRIMARY KEY,
        owner       TEXT NOT NULL,
        incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
        logged_at   TEXT NOT NULL,
        told_date   TEXT NOT NULL,
        told_time   TEXT,
        told_prec   TEXT NOT NULL,
        hap_date    TEXT NOT NULL,
        hap_time    TEXT,
        hap_prec    TEXT NOT NULL,
        place_id    TEXT REFERENCES places(id),
        text        TEXT NOT NULL,
        told_by     TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX incident_notes_incident ON incident_notes (incident_id);
      CREATE INDEX incident_notes_place ON incident_notes (place_id);
      CREATE TRIGGER incident_notes_are_fixed BEFORE UPDATE ON incident_notes
      BEGIN
        SELECT RAISE(ABORT, 'Hearsay is never changed');
      END;

      -- What someone reportedly said about me to others: hearsay too, and never changed.
      CREATE TABLE reports (
        id        TEXT PRIMARY KEY,
        owner     TEXT NOT NULL,
        person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        logged_at TEXT NOT NULL,
        told_date TEXT NOT NULL,
        told_time TEXT,
        told_prec TEXT NOT NULL,
        hap_date  TEXT NOT NULL,
        hap_time  TEXT,
        hap_prec  TEXT NOT NULL,
        place_id  TEXT REFERENCES places(id),
        text      TEXT NOT NULL,
        told_by   TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX reports_person ON reports (person_id);
      CREATE INDEX reports_place ON reports (place_id);
      CREATE TRIGGER reports_are_fixed BEFORE UPDATE ON reports
      BEGIN
        SELECT RAISE(ABORT, 'Hearsay is never changed');
      END;

      ALTER TABLE entries ADD COLUMN credit INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE entries ADD COLUMN incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL;
      CREATE INDEX entries_incident ON entries (incident_id);

      CREATE TABLE care_notes (
        id           TEXT PRIMARY KEY,
        owner        TEXT NOT NULL,
        person_id    TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        level        TEXT NOT NULL,
        text         TEXT NOT NULL,
        on_date      TEXT,                           -- MM-DD: a day that is hard for them
        since        TEXT NOT NULL,
        source_id    TEXT REFERENCES entries(id) ON DELETE SET NULL,
        confirmed_on TEXT NOT NULL,
        retired_on   TEXT
      );
      CREATE INDEX care_notes_person ON care_notes (person_id);
      CREATE INDEX care_notes_source ON care_notes (source_id);

      CREATE TABLE words_given (
        id         TEXT PRIMARY KEY,
        owner      TEXT NOT NULL,
        person_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        direction  TEXT NOT NULL,                    -- me, they: who gave their word
        words      TEXT NOT NULL,
        made_on    TEXT NOT NULL,
        due_on     TEXT,
        outcome    TEXT NOT NULL DEFAULT 'pending',
        outcome_on TEXT,
        source_id  TEXT REFERENCES entries(id) ON DELETE SET NULL
      );
      CREATE INDEX words_given_person ON words_given (person_id);

      CREATE TABLE concerns (
        id          TEXT PRIMARY KEY,
        owner       TEXT NOT NULL,
        person_id   TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        text        TEXT NOT NULL,
        opened_on   TEXT NOT NULL,
        review_on   TEXT NOT NULL,
        state       TEXT NOT NULL DEFAULT 'open',    -- open, dismissed, breach
        review_note TEXT NOT NULL DEFAULT '',
        reviewed_on TEXT
      );
      CREATE INDEX concerns_person ON concerns (person_id);

      CREATE TABLE concern_evidence (
        concern_id TEXT NOT NULL REFERENCES concerns(id) ON DELETE CASCADE,
        entry_id   TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        PRIMARY KEY (concern_id, entry_id)
      ) WITHOUT ROWID;
      CREATE INDEX concern_evidence_entry ON concern_evidence (entry_id);

      CREATE TABLE corrections (
        id        TEXT PRIMARY KEY,
        owner     TEXT NOT NULL,
        person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        on_date   TEXT NOT NULL,
        text      TEXT NOT NULL,
        entry_id  TEXT REFERENCES entries(id) ON DELETE SET NULL
      );
      CREATE INDEX corrections_person ON corrections (person_id);
    `);
  },
];

/**
 * Opens (creating if needed) the database at `file`, or ":memory:", at the latest schema. A test of
 * an upgrade can stop at an earlier `version`.
 */
export function openDatabase(file: string, version: number = migrations.length): DatabaseSync {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  // Overwrite deleted entries with zeros instead of leaving them in free pages. The journal mode
  // stays the default: one file, nothing beside it to forget in a backup.
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
