import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// systemd sets STATE_DIRECTORY (/var/lib/fafnir), keeping the books outside the app and private to
// the service; locally it falls back to ./data.
export const DB_FILE = join(process.env.STATE_DIRECTORY ?? "data", "fafnir.db");

// Each entry upgrades the schema by one version; PRAGMA user_version records how far we got.
// Add new steps to the end, never edit old ones.
const migrations: ((db: DatabaseSync) => void)[] = [
  // v1: the books (double entry: every transaction's postings add up to zero), and the rates.
  (db) => {
    db.exec(`
      CREATE TABLE books (
        owner      TEXT PRIMARY KEY,                 -- Heimdall username
        created_at TEXT NOT NULL
      );

      -- Everything money can be in or come from. The page calls some of these accounts and some
      -- categories; "starting" and "adjustment" are the two every user has and never sees.
      CREATE TABLE accounts (
        id         TEXT PRIMARY KEY,
        owner      TEXT NOT NULL,
        name       TEXT NOT NULL,
        kind       TEXT NOT NULL,                    -- what it is; see MONEY_KINDS, CATEGORY_KINDS and the hidden ones
        currency   TEXT,                             -- NULL unless it is one of cash, bank, savings, card
        grp        TEXT NOT NULL DEFAULT '',
        closed     INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX accounts_owner ON accounts (owner, kind);

      CREATE TABLE transactions (
        id          TEXT PRIMARY KEY,                -- made by the browser
        owner       TEXT NOT NULL,
        kind        TEXT NOT NULL,                   -- spent, received, moved, starting, adjustment
        date        TEXT NOT NULL,                   -- the user's calendar day, YYYY-MM-DD
        memo        TEXT NOT NULL DEFAULT '',
        rate        REAL,                            -- reais per dollar behind the postings' usd; NULL if none was used
        rate_date   TEXT,
        rate_source TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX transactions_owner ON transactions (owner, date, created_at);

      -- amount is in cents of currency, usd in US cents. For one transaction, each currency's
      -- amounts add up to zero, and so does usd.
      CREATE TABLE postings (
        tx_id      TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        seq        INTEGER NOT NULL,                 -- 0 is the entry's account, 1 its other side
        account_id TEXT NOT NULL REFERENCES accounts(id),
        currency   TEXT NOT NULL,
        amount     INTEGER NOT NULL,
        usd        INTEGER NOT NULL,
        PRIMARY KEY (tx_id, seq)
      ) WITHOUT ROWID;
      CREATE INDEX postings_account ON postings (account_id);

      -- Each transaction as it was before being changed or deleted.
      CREATE TABLE history (
        seq      INTEGER PRIMARY KEY,
        owner    TEXT NOT NULL,
        tx_id    TEXT NOT NULL,
        action   TEXT NOT NULL,                      -- changed, deleted
        at       TEXT NOT NULL,
        snapshot TEXT NOT NULL                       -- the entry, as JSON
      );
      CREATE INDEX history_owner ON history (owner, tx_id);

      -- Public figures, shared by every user. quote per one base: BRL per one USD.
      CREATE TABLE rates (
        date       TEXT NOT NULL,
        base       TEXT NOT NULL,
        quote      TEXT NOT NULL,
        value      REAL NOT NULL,
        source     TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (base, quote, date)
      ) WITHOUT ROWID;
    `);
  },
  // v2: exchanges (through one hidden account per user, which holds whatever currencies pass through
  // it) and the price of a purchase made in another currency.
  (db) => {
    db.exec(`
      ALTER TABLE transactions ADD COLUMN paid_currency TEXT;
      ALTER TABLE transactions ADD COLUMN paid_amount INTEGER;
      INSERT INTO accounts (id, owner, name, kind, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), owner, 'Currency exchange', 'exchange', created_at, created_at FROM books;
    `);
  },
  // v3: coins. A transaction says which currency its rate is the rate of (until now, always reais), and
  // everyone gets the two categories crypto needs, unless they already have one of that name.
  (db) => {
    db.exec(`
      ALTER TABLE transactions ADD COLUMN rate_currency TEXT;
      INSERT INTO accounts (id, owner, name, kind, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), owner, 'Fees', 'expense', created_at, created_at FROM books b
        WHERE NOT EXISTS (
          SELECT 1 FROM accounts a WHERE a.owner = b.owner AND a.kind = 'expense' AND a.name = 'Fees' COLLATE NOCASE
        );
      INSERT INTO accounts (id, owner, name, kind, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), owner, 'Staking rewards', 'income', created_at, created_at FROM books b
        WHERE NOT EXISTS (
          SELECT 1 FROM accounts a
          WHERE a.owner = b.owner AND a.kind = 'income' AND a.name = 'Staking rewards' COLLATE NOCASE
        );
    `);
  },
  // v4: loans are accounts and entries like any other. All they need is somewhere for interest to go,
  // and the income side already has a category for it.
  (db) => {
    db.exec(`
      INSERT INTO accounts (id, owner, name, kind, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), owner, 'Interest paid', 'expense', created_at, created_at FROM books b
        WHERE NOT EXISTS (
          SELECT 1 FROM accounts a
          WHERE a.owner = b.owner AND a.kind = 'expense' AND a.name = 'Interest paid' COLLATE NOCASE
        );
    `);
  },
  // v5: things the user owns. A new value typed for one is set against a hidden account of its own, so
  // it shows apart from balance checks.
  (db) => {
    db.exec(`
      INSERT INTO accounts (id, owner, name, kind, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), owner, 'Value changes', 'revaluation', created_at, created_at FROM books;
    `);
  },
];

/** Opens (creating if needed) the database at `file`, or ":memory:", at the latest schema. */
export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  // Overwrite deleted entries with zeros instead of leaving them in free pages. The journal mode
  // stays the default: one file, nothing beside it to forget in a backup.
  db.exec("PRAGMA secure_delete = ON");
  migrate(db);
  return db;
}

/** Brings a database up to schema version `upTo`, by default the latest. */
export function migrate(db: DatabaseSync, upTo = migrations.length): void {
  const { user_version: current } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = current; v < upTo; v++) {
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
}
