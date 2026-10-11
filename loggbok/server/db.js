import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// systemd sets STATE_DIRECTORY (/var/lib/loggbok), keeping notes out of the checkout and
// private to the service; locally it falls back to this folder.
const DATA_DIR = process.env.STATE_DIRECTORY ?? __dirname;
const DB_FILE = join(DATA_DIR, 'notes.db');

// A database left next to the code by an install from before STATE_DIRECTORY.
const OLD_FILE = join(__dirname, 'notes.db');
if (DB_FILE !== OLD_FILE && existsSync(OLD_FILE)) {
  if (!existsSync(DB_FILE)) {
    // Starting empty would make everyone's notes look lost, and new ones would split from them.
    console.error(
      `The notes are still at ${OLD_FILE}, but this service keeps them in ${DATA_DIR}.\n` +
      'Move them once, then start the service again:\n' +
      '  sudo systemctl stop loggbok\n' +
      `  sudo mv ${OLD_FILE}* ${DATA_DIR}/\n` +
      `  sudo chown "$(stat -c %U ${DATA_DIR})": ${DB_FILE}* && sudo chmod 600 ${DB_FILE}*\n` +
      '  sudo systemctl start loggbok'
    );
    process.exit(1);
  }
  console.warn(`An old copy of the notes is still at ${OLD_FILE}, readable outside the service. Delete it.`);
}

export const db = new DatabaseSync(DB_FILE);
console.log(`Notes database: ${DB_FILE}`);

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
