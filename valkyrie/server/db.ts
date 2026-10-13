import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// systemd sets STATE_DIRECTORY (/var/lib/valkyrie), keeping the boards outside the app and
// private to the service; locally it falls back to ./data.
export const DB_FILE = join(process.env.STATE_DIRECTORY ?? "data", "valkyrie.db");

// Each entry upgrades the schema by one version; PRAGMA user_version records how far we got.
// Add new steps to the end, never edit old ones.
//
// Every ordered row has a rank: a fractional index (fractional-indexing's keys, ASCII digits and
// letters), compared as plain text. Equal ranks are ordered by id.
const migrations: ((db: DatabaseSync) => void)[] = [
  // v1: boards, their lists, labels and cards, and the cards' checklists.
  (db) => {
    db.exec(`
      CREATE TABLE boards (
        id         TEXT PRIMARY KEY,
        owner      TEXT NOT NULL,                    -- Heimdall username
        name       TEXT NOT NULL,                    -- unique per owner, ignoring case (checked in store.ts)
        color      TEXT NOT NULL,
        rank       TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX boards_owner ON boards (owner, rank);
      CREATE TABLE lists (
        id         TEXT PRIMARY KEY,
        owner      TEXT NOT NULL,
        board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        rank       TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX lists_board ON lists (board_id, rank);
      CREATE TABLE labels (
        id       TEXT PRIMARY KEY,
        owner    TEXT NOT NULL,
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        name     TEXT NOT NULL,                      -- may be '': just a colour
        color    TEXT NOT NULL,
        rank     TEXT NOT NULL
      );
      CREATE INDEX labels_board ON labels (board_id, rank);
      CREATE TABLE cards (
        id          TEXT PRIMARY KEY,
        owner       TEXT NOT NULL,
        board_id    TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,  -- always its list's board
        list_id     TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
        rank        TEXT NOT NULL,
        title       TEXT NOT NULL,
        description TEXT NOT NULL,
        due_date    TEXT,                            -- YYYY-MM-DD
        rev         INTEGER NOT NULL,                -- from meta 'rev': never the same twice
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX cards_list ON cards (list_id, rank);
      CREATE INDEX cards_board ON cards (board_id);
      CREATE INDEX cards_owner ON cards (owner);
      CREATE TABLE card_labels (
        card_id  TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
        PRIMARY KEY (card_id, label_id)
      ) WITHOUT ROWID;
      CREATE INDEX card_labels_label ON card_labels (label_id);
      CREATE TABLE checklist_items (
        id      TEXT PRIMARY KEY,
        owner   TEXT NOT NULL,
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        text    TEXT NOT NULL,
        done    INTEGER NOT NULL DEFAULT 0,
        rank    TEXT NOT NULL
      );
      CREATE INDEX checklist_items_card ON checklist_items (card_id, rank);
      -- 'rev': the last revision given to a card.
      CREATE TABLE meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
      INSERT INTO meta (key, value) VALUES ('rev', 0);
    `);
  },
];

/** Opens (creating if needed) the database at `file`, or ":memory:", at the latest schema. */
export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  // Overwrite deleted cards with zeros instead of leaving them in free pages. The journal mode
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
