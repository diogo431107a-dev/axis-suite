import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const db = new DatabaseSync(join(__dirname, 'notes.db'));

db.exec('PRAGMA foreign_keys = ON');

// Each entry upgrades the schema by one version; PRAGMA user_version records how far we got.
// Add new steps to the end, never edit old ones. Sharing will be the next step, e.g.:
//   CREATE TABLE note_shares (
//     note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
//     username   TEXT NOT NULL,
//     permission TEXT NOT NULL CHECK (permission IN ('read', 'write')),
//     PRIMARY KEY (note_id, username)
//   );
const migrations = [
  // v1: notes belong to a Heimdall user. Notes from before accounts existed have no owner and are discarded.
  () => {
    const old = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'notes'"
    ).get();
    if (old) {
      const { n } = db.prepare('SELECT COUNT(*) AS n FROM notes').get();
      db.exec('DROP TABLE notes');
      console.log(`Discarded ${n} note(s) from before user accounts`);
    }
    db.exec(`
      CREATE TABLE notes (
        id         TEXT PRIMARY KEY,
        owner      TEXT NOT NULL,  -- Heimdall username
        title      TEXT NOT NULL DEFAULT '',
        content    TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX notes_owner_updated ON notes (owner, updated_at DESC);
    `);
  },
];

const { user_version: current } = db.prepare('PRAGMA user_version').get();
for (let v = current; v < migrations.length; v++) {
  db.exec('BEGIN');
  try {
    migrations[v]();
    db.exec(`PRAGMA user_version = ${v + 1}`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
