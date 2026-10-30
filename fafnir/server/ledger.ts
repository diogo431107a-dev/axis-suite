// The books: turning what the user says happened into postings that add up to zero, and reading
// balances and totals back. Dollars are worked out once, when an entry is saved, and then stay.
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  CATEGORY_KINDS,
  CURRENCIES,
  ENTRY_KINDS,
  LIMITS,
  MONEY_KINDS,
  type Account,
  type AccountChange,
  type BalanceCheck,
  type BalanceCheckResult,
  type Book,
  type CategoryKind,
  type Currency,
  type Entry,
  type EntryChange,
  type EntryPage,
  type Foreign,
  type IsoDate,
  type MoneyAccount,
  type MoneyKind,
  type MonthSummary,
  type NewAccount,
  type NewCategory,
  type NewEntry,
  type Rate,
  type WorthChange,
} from "../shared/protocol.ts";
import { StoreError, conflict, invalid, notFound, tooMany, transaction } from "./errors.ts";
import { addDays, monthSpan, today } from "./rates.ts";

const STARTING_CATEGORIES: Record<CategoryKind, string[]> = {
  expense: ["Food", "Home", "Transport", "Health", "Fun", "Shopping", "Bills", "Other"],
  income: ["Salary", "Gifts", "Interest", "Other"],
};

interface AccountRow {
  id: string;
  owner: string;
  name: string;
  kind: string;
  currency: string | null;
  grp: string;
  closed: number;
  entries: number;
}

interface TxRow {
  id: string;
  kind: Entry["kind"];
  date: string;
  memo: string;
  rate: number | null;
  rate_date: string | null;
  rate_source: string | null;
  account_id: string;
  other_id: string | null;
  currency: Currency;
  amount: number;
  usd: number;
  paid_currency: Currency | null;
  paid_amount: number | null;
  arrived_currency: Currency | null;
  arrived_amount: number | null;
}

interface Posting {
  account: string;
  currency: Currency;
  amount: number;
  usd: number;
}

const isMoneyKind = (kind: unknown): kind is MoneyKind => MONEY_KINDS.includes(kind as MoneyKind);
const isCategoryKind = (kind: unknown): kind is CategoryKind => CATEGORY_KINDS.includes(kind as CategoryKind);
export const isMonth = (month: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month);

function checkId(id: unknown): string {
  if (typeof id !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(id)) invalid("That id isn't valid");
  return id;
}

function checkText(value: unknown, what: string, max: number): string {
  if (value === undefined) return "";
  if (typeof value !== "string") invalid(`${what} must be text`);
  const text = value.trim();
  if (text.length > max) invalid(`${what} can be at most ${max} characters`);
  return text;
}

function checkName(value: unknown): string {
  const name = checkText(value, "The name", LIMITS.name);
  if (!name) invalid("Give it a name");
  return name;
}

function checkDate(value: unknown): IsoDate {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid("That date isn't valid");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid("That date isn't valid");
  if (value < "2000-01-01") invalid("Dates start in the year 2000");
  // One day of leeway: it can already be tomorrow where the user is.
  if (value > addDays(today(), 1)) invalid("That date is in the future");
  return value;
}

/** A whole number of cents. `signed` allows it to be below zero, and zero. */
function checkCents(value: unknown, what: string, signed = false): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) invalid(`${what} isn't a valid amount`);
  if (Math.abs(value) > LIMITS.amount) invalid(`${what} is too large`);
  if (!signed && value <= 0) invalid(`${what} must be above zero`);
  return value;
}

/** Every transaction, whatever made it, has to pass this before it is written. */
export function assertBalanced(postings: Posting[]): void {
  const totals = new Map<string, number>();
  let usd = 0;
  for (const p of postings) {
    totals.set(p.currency, (totals.get(p.currency) ?? 0) + p.amount);
    usd += p.usd;
  }
  for (const [currency, total] of totals) {
    if (total !== 0) throw new Error(`Unbalanced transaction: ${currency} adds up to ${total}`);
  }
  if (usd !== 0) throw new Error(`Unbalanced transaction: USD value adds up to ${usd}`);
}

export interface Ledger {
  load(owner: string, month: string): Book;
  listEntries(
    owner: string,
    filter: { account?: string | undefined; q?: string | undefined; offset?: number | undefined },
  ): EntryPage;
  addEntry(owner: string, input: NewEntry): Entry;
  changeEntry(owner: string, id: string, input: EntryChange): Entry;
  removeEntry(owner: string, id: string): void;
  addAccount(owner: string, input: NewAccount): void;
  addCategory(owner: string, input: NewCategory): void;
  changeAccount(owner: string, id: string, input: AccountChange): void;
  removeAccount(owner: string, id: string): void;
  checkBalance(owner: string, accountId: string, input: BalanceCheck): BalanceCheckResult;
  /** Everything of one user, as saved: their copy, and the way out. */
  exportAll(owner: string): unknown;
  /** Every entry, oldest first, for a spreadsheet. */
  allEntries(owner: string): Entry[];
  /** The owners not in `known` lose everything; returns who, and how many entries they had. */
  removeUnknownOwners(known: ReadonlySet<string>): { owner: string; entries: number }[];
}

export function createLedger(db: DatabaseSync, lookupRate: (date: IsoDate) => Rate | null): Ledger {
  const now = () => new Date().toISOString();

  function ensureBook(owner: string): void {
    const exists = db.prepare("SELECT 1 FROM books WHERE owner = ?").get(owner);
    if (exists) return;
    transaction(db, () => {
      const at = now();
      db.prepare("INSERT INTO books (owner, created_at) VALUES (?, ?)").run(owner, at);
      const add = db.prepare(`
        INSERT INTO accounts (id, owner, name, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      `);
      add.run(randomUUID(), owner, "Starting balance", "starting", at, at);
      add.run(randomUUID(), owner, "Balance check", "adjustment", at, at);
      add.run(randomUUID(), owner, "Currency exchange", "exchange", at, at);
      for (const kind of CATEGORY_KINDS) {
        for (const name of STARTING_CATEGORIES[kind]) add.run(randomUUID(), owner, name, kind, at, at);
      }
    });
  }

  function accountRow(owner: string, id: unknown): AccountRow | undefined {
    if (typeof id !== "string") return undefined;
    return db.prepare("SELECT * FROM accounts WHERE id = ? AND owner = ?").get(id, owner) as unknown as
      AccountRow | undefined;
  }

  function systemAccount(owner: string, kind: "starting" | "adjustment" | "exchange"): string {
    const row = db.prepare("SELECT id FROM accounts WHERE owner = ? AND kind = ?").get(owner, kind) as { id: string };
    return row.id;
  }

  // An exchange has four postings, and the money reaches the other account in the last one.
  const ENTRY_JOINS = `
    FROM transactions t
    JOIN postings p0 ON p0.tx_id = t.id AND p0.seq = 0
    JOIN postings p1 ON p1.tx_id = t.id AND p1.seq = 1
    LEFT JOIN postings p3 ON p3.tx_id = t.id AND p3.seq = 3
    JOIN accounts a1 ON a1.id = COALESCE(p3.account_id, p1.account_id)
  `;
  const ENTRY_SELECT = `
    SELECT t.id, t.kind, t.date, t.memo, t.rate, t.rate_date, t.rate_source, t.paid_currency, t.paid_amount,
           p0.account_id, p0.currency, p0.amount, p0.usd,
           COALESCE(p3.account_id, p1.account_id) AS other_id,
           p3.currency AS arrived_currency, p3.amount AS arrived_amount
    ${ENTRY_JOINS}
  `;

  function toEntry(row: TxRow): Entry {
    const system = row.kind === "starting" || row.kind === "adjustment";
    // The first posting is the account's: money leaving it is below zero, but a spent, moved or
    // exchanged entry reads as a positive amount.
    const flip = row.kind === "spent" || row.kind === "moved" || row.kind === "exchanged";
    return {
      id: row.id,
      kind: row.kind,
      date: row.date,
      memo: row.memo,
      account: row.account_id,
      other: system ? null : row.other_id,
      currency: row.currency,
      amount: flip ? -row.amount : row.amount,
      usd: flip ? -row.usd : row.usd,
      rate: row.rate === null ? null : { value: row.rate, date: row.rate_date!, source: row.rate_source! },
      paid: row.paid_currency === null ? null : { currency: row.paid_currency, amount: row.paid_amount! },
      arrived: row.arrived_currency === null ? null : { currency: row.arrived_currency, amount: row.arrived_amount! },
    };
  }

  function readEntry(owner: string, id: string): Entry | null {
    const row = db.prepare(`${ENTRY_SELECT} WHERE t.id = ? AND t.owner = ?`).get(id, owner) as unknown as
      TxRow | undefined;
    return row ? toEntry(row) : null;
  }

  /** The dollars of an amount on a day, and the rate they came from. Amounts keep their sign. */
  function dollars(
    currency: Currency,
    amount: number,
    date: IsoDate,
    typed: unknown,
  ): { usd: number; rate: Rate | null } {
    if (currency === "USD") return { usd: amount, rate: null };
    if (typed !== undefined) {
      const usd = checkCents(typed, "The US dollar amount", true);
      if (Math.sign(usd) !== Math.sign(amount)) {
        invalid("The US dollar amount must go the same way as the amount");
      }
      return { usd, rate: null };
    }
    const rate = lookupRate(date);
    if (!rate) {
      throw new StoreError(409, "No exchange rate is known for that day. Type the US dollar amount.", "no-rate");
    }
    return { usd: Math.round(amount / rate.value), rate };
  }

  function writeTx(
    owner: string,
    id: string,
    kind: Entry["kind"],
    date: IsoDate,
    memo: string,
    rate: Rate | null,
    postings: Posting[],
    isNew: boolean,
    paid: Foreign | null = null,
  ): void {
    assertBalanced(postings);
    const at = now();
    if (isNew) {
      db.prepare(
        `
        INSERT INTO transactions
          (id, owner, kind, date, memo, rate, rate_date, rate_source, paid_currency, paid_amount, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        id,
        owner,
        kind,
        date,
        memo,
        rate?.value ?? null,
        rate?.date ?? null,
        rate?.source ?? null,
        paid?.currency ?? null,
        paid?.amount ?? null,
        at,
        at,
      );
    } else {
      db.prepare(
        `
        UPDATE transactions SET kind = ?, date = ?, memo = ?, rate = ?, rate_date = ?, rate_source = ?,
          paid_currency = ?, paid_amount = ?, updated_at = ?
        WHERE id = ? AND owner = ?
      `,
      ).run(
        kind,
        date,
        memo,
        rate?.value ?? null,
        rate?.date ?? null,
        rate?.source ?? null,
        paid?.currency ?? null,
        paid?.amount ?? null,
        at,
        id,
        owner,
      );
      db.prepare("DELETE FROM postings WHERE tx_id = ?").run(id);
    }
    const insert = db.prepare(`
      INSERT INTO postings (tx_id, seq, account_id, currency, amount, usd) VALUES (?, ?, ?, ?, ?, ?)
    `);
    postings.forEach((p, seq) => insert.run(id, seq, p.account, p.currency, p.amount, p.usd));
  }

  function remember(owner: string, entry: Entry, action: "changed" | "deleted"): void {
    db.prepare("INSERT INTO history (owner, tx_id, action, at, snapshot) VALUES (?, ?, ?, ?, ?)").run(
      owner,
      entry.id,
      action,
      now(),
      JSON.stringify(entry),
    );
  }

  /** Checks an account or category an entry names. A closed one is only fine if it was already there. */
  function usable(owner: string, id: unknown, previous: readonly (string | null)[] = []): AccountRow {
    const row = accountRow(owner, id);
    if (!row) notFound("account");
    if (row.closed && !previous.includes(row.id)) invalid(`${row.name} is closed`);
    return row;
  }

  /** Checks what a spent, received, moved or exchanged entry names. */
  function everydayPostings(
    owner: string,
    input: { kind: unknown; account: unknown; other?: unknown; amount: unknown },
    previous: readonly (string | null)[],
  ): { kind: Entry["kind"]; account: AccountRow; other: AccountRow; amount: number } {
    if (!ENTRY_KINDS.includes(input.kind as never)) invalid("That kind of entry doesn't exist");
    const kind = input.kind as Entry["kind"];
    const amount = checkCents(input.amount, "The amount");
    const account = usable(owner, input.account, previous);
    if (!isMoneyKind(account.kind)) invalid("Pick an account");
    const other = usable(owner, input.other, previous);
    if (kind === "spent" && other.kind !== "expense") invalid("Pick a spending category");
    if (kind === "received" && other.kind !== "income") invalid("Pick an income category");
    if (kind === "moved") {
      if (!isMoneyKind(other.kind)) invalid("Pick the account the money went to");
      if (other.id === account.id) invalid("Pick two different accounts");
      if (other.currency !== account.currency) {
        invalid("A move stays in one currency. Use Exchanged to change money into another currency.");
      }
    }
    if (kind === "exchanged") {
      if (!isMoneyKind(other.kind)) invalid("Pick the account the money went to");
      if (other.currency === account.currency) invalid("An exchange is between two currencies. Use Moved instead.");
    }
    return { kind, account, other, amount };
  }

  /** The price of a spent or received entry in the other currency, if it has one. */
  function checkPaid(kind: Entry["kind"], paid: unknown, currency: Currency): Foreign | null {
    if (paid === undefined || paid === null) return null;
    if (kind !== "spent" && kind !== "received") invalid("Only spending and income can be in another currency");
    const { currency: paidCurrency, amount } = paid as Partial<Foreign>;
    if (!CURRENCIES.includes(paidCurrency as Currency)) invalid("That currency isn't available");
    if (paidCurrency === currency) invalid("That's already the account's currency");
    return { currency: paidCurrency as Currency, amount: checkCents(amount, "The price") };
  }

  /**
   * The postings of an exchange. Each currency goes through the hidden exchange account, so each adds
   * up to zero, and no rate is needed for the books to balance. The US dollar side is what it was worth.
   */
  function exchangePostings(
    owner: string,
    from: { id: string; currency: Currency; amount: number },
    to: { id: string; currency: Currency; amount: number },
  ): Posting[] {
    const exchange = systemAccount(owner, "exchange");
    const usd = from.currency === "USD" ? from.amount : to.amount;
    return [
      { account: from.id, currency: from.currency, amount: -from.amount, usd: -usd },
      { account: exchange, currency: from.currency, amount: from.amount, usd },
      { account: exchange, currency: to.currency, amount: -to.amount, usd: -usd },
      { account: to.id, currency: to.currency, amount: to.amount, usd },
    ];
  }

  /** What a spent, received, moved or exchanged entry is written as. `before` is the entry it replaces. */
  function everydayTx(owner: string, input: NewEntry | EntryChange, date: IsoDate, before?: Entry) {
    const { kind, account, other, amount } = everydayPostings(
      owner,
      input,
      before ? [before.account, before.other] : [],
    );
    const currency = account.currency as Currency;

    if (kind === "exchanged") {
      const arrived = checkCents(input.arrived, "What arrived");
      const postings = exchangePostings(
        owner,
        { id: account.id, currency, amount },
        { id: other.id, currency: other.currency as Currency, amount: arrived },
      );
      return { kind, rate: null, paid: null, postings };
    }

    const paid = checkPaid(kind, input.paid, currency);
    let usd: number;
    let rate: Rate | null;
    if (paid) {
      // The US dollar side is what it cost, whichever side that is.
      usd = paid.currency === "USD" ? paid.amount : amount;
      rate = null;
    } else {
      // Dollars stay as they were saved unless what they depend on changed.
      const same =
        before?.paid === null && before.date === date && before.amount === amount && before.currency === currency;
      ({ usd, rate } =
        same && input.usd === undefined
          ? { usd: before.usd, rate: before.rate }
          : dollars(currency, amount, date, input.usd));
    }
    return { kind, rate, paid, postings: postingsOf(kind, account.id, other.id, currency, amount, usd) };
  }

  function postingsOf(
    kind: Entry["kind"],
    account: string,
    other: string,
    currency: Currency,
    amount: number,
    usd: number,
  ): Posting[] {
    // Money leaves the account on spent and moved; it arrives on the others.
    const sign = kind === "spent" || kind === "moved" ? -1 : 1;
    return [
      { account, currency, amount: sign * amount, usd: sign * usd },
      { account: other, currency, amount: -sign * amount, usd: -sign * usd },
    ];
  }

  function balanceOf(accountId: string, through?: IsoDate): number {
    const row = (
      through === undefined
        ? db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM postings WHERE account_id = ?").get(accountId)
        : db
            .prepare(
              `
                SELECT COALESCE(SUM(p.amount), 0) AS total
                FROM postings p JOIN transactions t ON t.id = p.tx_id
                WHERE p.account_id = ? AND t.date <= ?
              `,
            )
            .get(accountId, through)
    ) as { total: number };
    return row.total;
  }

  function roomForEntries(owner: string): void {
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE owner = ?").get(owner) as { n: number };
    if (n >= LIMITS.entriesPerUser) tooMany(`You can have up to ${LIMITS.entriesPerUser} entries`);
  }

  function roomForAccounts(owner: string): void {
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE owner = ?").get(owner) as { n: number };
    if (n >= LIMITS.accountsPerUser) tooMany(`You can have up to ${LIMITS.accountsPerUser} accounts and categories`);
  }

  function nameIsFree(owner: string, name: string, money: boolean, except?: string): void {
    const kinds = money ? MONEY_KINDS : null;
    const rows = db.prepare("SELECT id, name, kind FROM accounts WHERE owner = ?").all(owner) as unknown as {
      id: string;
      name: string;
      kind: string;
    }[];
    const taken = rows.some(
      (r) =>
        r.id !== except &&
        r.name.toLowerCase() === name.toLowerCase() &&
        (kinds ? isMoneyKind(r.kind) : isCategoryKind(r.kind)),
    );
    if (taken) conflict(`You already have ${name}`);
  }

  /** What the user was worth at the end of a day, at that day's rate; null if the rate is needed and unknown. */
  function worthOn(owner: string, date: IsoDate): number | null {
    const rows = db
      .prepare(
        `
        SELECT a.currency AS currency, SUM(p.amount) AS balance
        FROM postings p
        JOIN transactions t ON t.id = p.tx_id
        JOIN accounts a ON a.id = p.account_id
        WHERE t.owner = ? AND t.date <= ? AND a.kind IN ('cash', 'bank', 'savings', 'card')
        GROUP BY a.id
      `,
      )
      .all(owner, date) as unknown as { currency: Currency; balance: number }[];
    const rate = lookupRate(date);
    let worth = 0;
    for (const { currency, balance } of rows) {
      if (currency === "USD") worth += balance;
      else if (balance !== 0 && !rate) return null;
      else if (rate) worth += Math.round(balance / rate.value);
    }
    return worth;
  }

  function worthChange(owner: string, month: string, moneyIn: number, moneyOut: number): WorthChange | null {
    const { start: startDay, end: endDay } = monthSpan(month);
    if (startDay >= endDay) return null;
    const start = worthOn(owner, startDay);
    const end = worthOn(owner, endDay);
    if (start === null || end === null) return null;
    const { added } = db
      .prepare(
        `
        SELECT COALESCE(SUM(p.usd), 0) AS added
        FROM transactions t JOIN postings p ON p.tx_id = t.id AND p.seq = 0
        WHERE t.owner = ? AND t.date > ? AND t.date <= ? AND t.kind IN ('starting', 'adjustment')
      `,
      )
      .get(owner, startDay, endDay) as { added: number };
    return { start, end, added, rates: end - start - moneyIn + moneyOut - added };
  }

  function monthSummary(owner: string, month: string): MonthSummary {
    const from = `${month}-01`;
    const to = `${month}-31`;
    const rows = db
      .prepare(
        `
        SELECT a.id AS category, a.kind AS kind, SUM(p.usd) AS usd
        FROM postings p
        JOIN transactions t ON t.id = p.tx_id
        JOIN accounts a ON a.id = p.account_id
        WHERE t.owner = ? AND t.date BETWEEN ? AND ? AND a.kind IN ('expense', 'income')
        GROUP BY a.id
      `,
      )
      .all(owner, from, to) as unknown as { category: string; kind: CategoryKind; usd: number }[];
    const spending = rows
      .filter((r) => r.kind === "expense" && r.usd !== 0)
      .map((r) => ({ category: r.category, usd: r.usd }))
      .sort((a, b) => b.usd - a.usd);
    const moneyIn = rows.filter((r) => r.kind === "income").reduce((sum, r) => sum - r.usd, 0);
    const moneyOut = spending.reduce((sum, r) => sum + r.usd, 0);
    return { month, moneyIn, moneyOut, spending, change: worthChange(owner, month, moneyIn, moneyOut) };
  }

  return {
    load(owner, month) {
      if (!isMonth(month)) invalid("That month isn't valid");
      ensureBook(owner);
      const rows = db
        .prepare(
          `
          SELECT a.*, COUNT(p.tx_id) AS entries, COALESCE(SUM(p.amount), 0) AS balance
          FROM accounts a LEFT JOIN postings p ON p.account_id = a.id
          WHERE a.owner = ? AND a.kind NOT IN ('starting', 'adjustment', 'exchange')
          GROUP BY a.id
          ORDER BY a.grp COLLATE NOCASE, a.name COLLATE NOCASE
        `,
        )
        .all(owner) as unknown as (AccountRow & { balance: number })[];

      const rate = lookupRate(today());
      let have = 0;
      let owe = 0;
      let missingRate = false;
      const accounts: MoneyAccount[] = [];
      const categories: Account[] = [];
      for (const row of rows) {
        const base = {
          id: row.id,
          name: row.name,
          group: row.grp,
          closed: row.closed === 1,
          entries: row.entries,
        };
        if (isMoneyKind(row.kind)) {
          const currency = row.currency as Currency;
          let usdNow: number | null = row.balance;
          if (currency !== "USD") usdNow = rate ? Math.round(row.balance / rate.value) : null;
          if (usdNow === null) missingRate ||= row.balance !== 0;
          else if (usdNow >= 0) have += usdNow;
          else owe -= usdNow;
          accounts.push({ ...base, kind: row.kind, currency, balance: row.balance, usdNow });
        } else {
          categories.push({ ...base, kind: row.kind as CategoryKind, currency: null });
        }
      }
      return { accounts, categories, rate, have, owe, missingRate, month: monthSummary(owner, month) };
    },

    listEntries(owner, { account, q, offset }) {
      ensureBook(owner);
      const conditions = ["t.owner = ?"];
      const params: (string | number)[] = [owner];
      if (account) {
        conditions.push("(p0.account_id = ? OR p1.account_id = ? OR p3.account_id = ?)");
        params.push(account, account, account);
      }
      if (q) {
        const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
        conditions.push(`(t.memo LIKE ? ESCAPE '\\' OR a1.name LIKE ? ESCAPE '\\')`);
        params.push(like, like);
      }
      const where = conditions.join(" AND ");
      const { n } = db
        .prepare(
          `
          SELECT COUNT(*) AS n ${ENTRY_JOINS}
          WHERE ${where}
        `,
        )
        .get(...params) as { n: number };
      const rows = db
        .prepare(`${ENTRY_SELECT} WHERE ${where} ORDER BY t.date DESC, t.created_at DESC LIMIT ? OFFSET ?`)
        .all(...params, LIMITS.entriesPerPage, Math.max(0, offset ?? 0)) as unknown as TxRow[];
      return { entries: rows.map(toEntry), total: n };
    },

    addEntry(owner, input) {
      ensureBook(owner);
      const id = checkId(input.id);
      return transaction(db, () => {
        // Sent twice (the first answer got lost): the first one stands.
        const existing = readEntry(owner, id);
        if (existing) return existing;
        if (db.prepare("SELECT 1 FROM transactions WHERE id = ?").get(id)) invalid("That id isn't valid");
        roomForEntries(owner);
        const date = checkDate(input.date);
        const memo = checkText(input.memo, "The note", LIMITS.memo);
        const { kind, rate, paid, postings } = everydayTx(owner, input, date);
        writeTx(owner, id, kind, date, memo, rate, postings, true, paid);
        return readEntry(owner, id)!;
      });
    },

    changeEntry(owner, id, input) {
      return transaction(db, () => {
        const before = readEntry(owner, id);
        if (!before) notFound("entry");
        if (before.kind === "adjustment") conflict("A balance check can't be changed, only deleted");
        if ((input.kind === "starting") !== (before.kind === "starting")) {
          invalid("A starting balance can't become another kind of entry");
        }
        const date = checkDate(input.date);
        const memo = checkText(input.memo, "The note", LIMITS.memo);

        if (before.kind === "starting") {
          const amount = checkCents(input.amount, "The amount", true);
          if (amount === 0) invalid("A starting balance can't be zero. Delete it instead.");
          const same = date === before.date && amount === before.amount && input.usd === undefined;
          const { usd, rate } = same
            ? { usd: before.usd, rate: before.rate }
            : dollars(before.currency, amount, date, input.usd);
          const other = systemAccount(owner, "starting");
          const postings = postingsOf("starting", before.account, other, before.currency, amount, usd);
          remember(owner, before, "changed");
          writeTx(owner, id, "starting", date, memo, rate, postings, false);
          return readEntry(owner, id)!;
        }

        const { kind, rate, paid, postings } = everydayTx(owner, input, date, before);
        remember(owner, before, "changed");
        writeTx(owner, id, kind, date, memo, rate, postings, false, paid);
        return readEntry(owner, id)!;
      });
    },

    removeEntry(owner, id) {
      transaction(db, () => {
        const before = readEntry(owner, id);
        if (!before) notFound("entry");
        remember(owner, before, "deleted");
        db.prepare("DELETE FROM transactions WHERE id = ? AND owner = ?").run(id, owner);
      });
    },

    addAccount(owner, input) {
      ensureBook(owner);
      const id = checkId(input.id);
      transaction(db, () => {
        if (accountRow(owner, id)) return;
        if (db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(id)) invalid("That id isn't valid");
        roomForAccounts(owner);
        const name = checkName(input.name);
        nameIsFree(owner, name, true);
        if (!isMoneyKind(input.kind)) invalid("That kind of account doesn't exist");
        if (!CURRENCIES.includes(input.currency)) invalid("That currency isn't available");
        const group = checkText(input.group, "The group", LIMITS.group);
        const starting = input.starting === undefined ? 0 : checkCents(input.starting, "The balance", true);
        const at = now();
        db.prepare(
          `
          INSERT INTO accounts (id, owner, name, kind, currency, grp, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        ).run(id, owner, name, input.kind, input.currency, group, at, at);
        if (starting !== 0) {
          const date = checkDate(input.date);
          const { usd, rate } = dollars(input.currency, starting, date, input.usd);
          const postings = postingsOf("starting", id, systemAccount(owner, "starting"), input.currency, starting, usd);
          writeTx(owner, randomUUID(), "starting", date, "", rate, postings, true);
        }
      });
    },

    addCategory(owner, input) {
      ensureBook(owner);
      const id = checkId(input.id);
      transaction(db, () => {
        if (accountRow(owner, id)) return;
        if (db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(id)) invalid("That id isn't valid");
        roomForAccounts(owner);
        const name = checkName(input.name);
        if (!isCategoryKind(input.kind)) invalid("That kind of category doesn't exist");
        const rows = db.prepare("SELECT 1 FROM accounts WHERE owner = ? AND kind = ? AND name = ? COLLATE NOCASE");
        if (rows.get(owner, input.kind, name)) conflict(`You already have ${name}`);
        const at = now();
        db.prepare(
          `
          INSERT INTO accounts (id, owner, name, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
        `,
        ).run(id, owner, name, input.kind, at, at);
      });
    },

    changeAccount(owner, id, input) {
      transaction(db, () => {
        const row = accountRow(owner, id);
        if (!row || !(isMoneyKind(row.kind) || isCategoryKind(row.kind))) notFound("account");
        const money = isMoneyKind(row.kind);
        const name = input.name === undefined ? row.name : checkName(input.name);
        if (money) {
          nameIsFree(owner, name, true, id);
        } else {
          const same = db
            .prepare("SELECT 1 FROM accounts WHERE owner = ? AND kind = ? AND name = ? COLLATE NOCASE AND id <> ?")
            .get(owner, row.kind, name, id);
          if (same) conflict(`You already have ${name}`);
        }
        const group = input.group === undefined ? row.grp : checkText(input.group, "The group", LIMITS.group);
        let kind = row.kind;
        if (input.kind !== undefined) {
          if (!money || !isMoneyKind(input.kind)) invalid("That kind of account doesn't exist");
          kind = input.kind;
        }
        const closed = input.closed === undefined ? row.closed === 1 : input.closed === true;
        if (closed && row.closed === 0 && money && balanceOf(id) !== 0) {
          conflict("Only an account with nothing in it can be closed. Move the money out first.");
        }
        db.prepare(
          `
          UPDATE accounts SET name = ?, grp = ?, kind = ?, closed = ?, updated_at = ? WHERE id = ? AND owner = ?
        `,
        ).run(name, group, kind, closed ? 1 : 0, now(), id, owner);
      });
    },

    removeAccount(owner, id) {
      transaction(db, () => {
        const row = accountRow(owner, id);
        if (!row || !(isMoneyKind(row.kind) || isCategoryKind(row.kind))) notFound("account");
        if (db.prepare("SELECT 1 FROM postings WHERE account_id = ? LIMIT 1").get(id)) {
          conflict(`${row.name} has entries, so it can only be closed`);
        }
        db.prepare("DELETE FROM accounts WHERE id = ? AND owner = ?").run(id, owner);
      });
    },

    checkBalance(owner, accountId, input) {
      const id = checkId(input.id);
      return transaction(db, () => {
        const account = accountRow(owner, accountId);
        if (!account || !isMoneyKind(account.kind)) notFound("account");
        const existing = readEntry(owner, id);
        const date = checkDate(input.date);
        if (existing) return { recorded: balanceOf(accountId, date) - existing.amount, entry: existing };
        if (db.prepare("SELECT 1 FROM transactions WHERE id = ?").get(id)) invalid("That id isn't valid");
        const actual = checkCents(input.actual, "The balance", true);
        const recorded = balanceOf(accountId, date);
        const difference = actual - recorded;
        if (difference === 0) return { recorded, entry: null };
        if (Math.abs(difference) > LIMITS.amount) invalid("The difference is too large");
        roomForEntries(owner);
        const currency = account.currency as Currency;
        const { usd, rate } = dollars(currency, difference, date, input.usd);
        const postings = postingsOf(
          "adjustment",
          accountId,
          systemAccount(owner, "adjustment"),
          currency,
          difference,
          usd,
        );
        writeTx(owner, id, "adjustment", date, "", rate, postings, true);
        return { recorded, entry: readEntry(owner, id)! };
      });
    },

    exportAll(owner) {
      ensureBook(owner);
      const accounts = db.prepare("SELECT * FROM accounts WHERE owner = ? ORDER BY created_at").all(owner);
      const history = db
        .prepare("SELECT tx_id, action, at, snapshot FROM history WHERE owner = ? ORDER BY seq")
        .all(owner) as unknown as { tx_id: string; action: string; at: string; snapshot: string }[];
      return {
        exportedAt: now(),
        accounts: accounts.map((a) => {
          const { owner: _owner, ...rest } = a as unknown as AccountRow;
          return rest;
        }),
        entries: this.allEntries(owner),
        history: history.map((h) => ({ ...h, snapshot: JSON.parse(h.snapshot) as unknown })),
      };
    },

    allEntries(owner) {
      const rows = db
        .prepare(`${ENTRY_SELECT} WHERE t.owner = ? ORDER BY t.date, t.created_at`)
        .all(owner) as unknown as TxRow[];
      return rows.map(toEntry);
    },

    removeUnknownOwners(known) {
      const owners = db.prepare("SELECT owner FROM books").all() as unknown as { owner: string }[];
      const removed: { owner: string; entries: number }[] = [];
      for (const { owner } of owners) {
        if (known.has(owner)) continue;
        transaction(db, () => {
          const { n } = db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE owner = ?").get(owner) as {
            n: number;
          };
          db.prepare("DELETE FROM transactions WHERE owner = ?").run(owner);
          db.prepare("DELETE FROM history WHERE owner = ?").run(owner);
          db.prepare("DELETE FROM accounts WHERE owner = ?").run(owner);
          db.prepare("DELETE FROM books WHERE owner = ?").run(owner);
          removed.push({ owner, entries: n });
        });
      }
      return removed;
    },
  };
}
