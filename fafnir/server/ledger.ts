// The books: turning what the user says happened into postings that add up to zero, and reading
// balances and totals back. Dollars are worked out once, when an entry is saved, and then stay.
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { COINS, CURRENCY_INFO, isCoin, usdCents, type Coin } from "../shared/currencies.ts";
import {
  CATEGORY_KINDS,
  CURRENCIES,
  ENTRY_KINDS,
  LIMITS,
  MONEY_KINDS,
  hasOwnPage,
  isLoan,
  isLoanEntry,
  type Account,
  type AccountChange,
  type Assets,
  type AssetSummary,
  type BalanceCheck,
  type BalanceCheckResult,
  type Book,
  type CategoryKind,
  type Currency,
  type Entry,
  type EntryChange,
  type EntryPage,
  type Holdings,
  type Foreign,
  type IsoDate,
  type LoanEntryKind,
  type LoanKind,
  type LoanSummary,
  type Loans,
  type MoneyAccount,
  type MoneyKind,
  type MonthSummary,
  type NewAccount,
  type NewCategory,
  type NewEntry,
  type NewValue,
  type NewValueResult,
  type Sale,
  type Rate,
  type RatedCurrency,
  type SpendingMonths,
  type WorthChange,
  type WorthHistory,
  type WorthPart,
  type WorthPoint,
} from "../shared/protocol.ts";
import { StoreError, conflict, invalid, notFound, tooMany, transaction } from "./errors.ts";
import { coinCosts, type CoinChange } from "./holdings.ts";
import { addDays, monthSpan, today } from "./rates.ts";

const nextMonth = (month: string): string => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};
const previousMonth = (month: string): string => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

const FEES = "Fees";
const INTEREST_PAID = "Interest paid";
const INTEREST_EARNED = "Interest";

const STARTING_CATEGORIES: Record<CategoryKind, string[]> = {
  expense: ["Food", "Home", "Transport", "Health", "Fun", "Shopping", "Bills", FEES, INTEREST_PAID, "Other"],
  income: ["Salary", "Gifts", INTEREST_EARNED, "Staking rewards", "Other"],
};

/** Which side of an exchange says what it was worth: the first of these it involves. */
const VALUE_ORDER: Currency[] = ["USD", "USDC", "BRL", "BTC", "ICP"];

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
  rate_currency: RatedCurrency | null;
  account_id: string;
  other_id: string | null;
  currency: Currency;
  amount: number;
  usd: number;
  paid_currency: Currency | null;
  paid_amount: number | null;
  arrived_currency: Currency | null;
  arrived_amount: number | null;
  fee_currency: Currency | null;
  fee_amount: number | null;
  fee_usd: number | null;
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

/** A whole number of a currency's smallest unit. `signed` allows it to be below zero, and zero. */
function checkAmount(value: unknown, what: string, currency: Currency, signed = false): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) invalid(`${what} isn't a valid amount`);
  if (Math.abs(value) > CURRENCY_INFO[currency].largest) invalid(`${what} is too large`);
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
  /** Each coin the user has or had: how much, where, what it cost and what it's worth. */
  holdings(owner: string): Holdings;
  /** Each loan: what's left, what has come off it and what the interest has been. */
  loans(owner: string): Loans;
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
  /** A new value for something the user owns. */
  setValue(owner: string, assetId: string, input: NewValue): NewValueResult;
  /** Sells something the user owns: its value becomes the price, the money moves, and it closes. */
  sell(owner: string, assetId: string, input: Sale): void;
  /** Each thing the user owns: what it's worth, what it cost and how its value has changed. */
  assets(owner: string): Assets;
  /** The month of the user's first entry; null if they have none. */
  firstMonth(owner: string): string | null;
  /** What the user was worth at the end of each month, from their first entry to today. */
  worthHistory(owner: string): WorthHistory;
  /** `count` months of spending and income, ending with `month`. */
  spendingMonths(owner: string, month: string, count: number): SpendingMonths;
  /** Everything of one user, as saved: their copy, and the way out. */
  exportAll(owner: string): unknown;
  /** Every entry, oldest first, for a spreadsheet. */
  allEntries(owner: string): Entry[];
  /** The owners not in `known` lose everything; returns who, and how many entries they had. */
  removeUnknownOwners(known: ReadonlySet<string>): { owner: string; entries: number }[];
}

export function createLedger(db: DatabaseSync, lookupRate: (currency: Currency, date: IsoDate) => Rate | null): Ledger {
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
      add.run(randomUUID(), owner, "Value changes", "revaluation", at, at);
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

  function systemAccount(owner: string, kind: "starting" | "adjustment" | "exchange" | "revaluation"): string {
    const row = db.prepare("SELECT id FROM accounts WHERE owner = ? AND kind = ?").get(owner, kind) as { id: string };
    return row.id;
  }

  // An exchange has four postings, and the money reaches the other account in the last one. A fee or
  // interest comes after the rest: the third posting of a move or a payment, the fifth of an exchange.
  const ENTRY_JOINS = `
    FROM transactions t
    JOIN postings p0 ON p0.tx_id = t.id AND p0.seq = 0
    JOIN postings p1 ON p1.tx_id = t.id AND p1.seq = 1
    LEFT JOIN postings p3 ON p3.tx_id = t.id AND p3.seq = 3
    LEFT JOIN postings pf ON pf.tx_id = t.id AND pf.seq = CASE t.kind
      WHEN 'moved' THEN 2 WHEN 'repaid' THEN 2 WHEN 'collected' THEN 2 WHEN 'exchanged' THEN 4 END
    JOIN accounts a1 ON a1.id = COALESCE(p3.account_id, p1.account_id)
  `;
  const ENTRY_SELECT = `
    SELECT t.id, t.kind, t.date, t.memo, t.rate, t.rate_date, t.rate_source, t.rate_currency,
           t.paid_currency, t.paid_amount,
           p0.account_id, p0.currency, p0.amount, p0.usd,
           COALESCE(p3.account_id, p1.account_id) AS other_id,
           p3.currency AS arrived_currency, p3.amount AS arrived_amount,
           pf.currency AS fee_currency, pf.amount AS fee_amount, pf.usd AS fee_usd
    ${ENTRY_JOINS}
  `;

  function toEntry(row: TxRow): Entry {
    const system = row.kind === "starting" || row.kind === "adjustment" || row.kind === "revalued";
    // The first posting is the account's: money leaving it is below zero, but a spent, moved, exchanged
    // or repaid entry reads as a positive amount, and so does interest, whichever way it goes.
    const flip =
      row.kind === "spent" ||
      row.kind === "moved" ||
      row.kind === "exchanged" ||
      row.kind === "repaid" ||
      (row.kind === "interest" && row.amount < 0);
    const third =
      row.fee_currency === null
        ? null
        : { currency: row.fee_currency, amount: Math.abs(row.fee_amount!), usd: Math.abs(row.fee_usd!) };
    const isPayment = row.kind === "repaid" || row.kind === "collected";
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
      rate:
        row.rate === null
          ? null
          : {
              currency: row.rate_currency ?? "BRL",
              value: row.rate,
              date: row.rate_date!,
              source: row.rate_source!,
            },
      paid: row.paid_currency === null ? null : { currency: row.paid_currency, amount: row.paid_amount! },
      arrived: row.arrived_currency === null ? null : { currency: row.arrived_currency, amount: row.arrived_amount! },
      fee: isPayment ? null : third,
      interest: isPayment ? third : null,
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
      const usd = checkAmount(typed, "The US dollar amount", "USD", true);
      // Zero is fine: a coin can have cost nothing.
      if (usd !== 0 && Math.sign(usd) !== Math.sign(amount)) {
        invalid("The US dollar amount must go the same way as the amount");
      }
      return { usd, rate: null };
    }
    const rate = lookupRate(currency, date);
    if (!rate) {
      throw new StoreError(409, "No rate or price is known for that day. Type the US dollar amount.", "no-rate");
    }
    return { usd: usdCents(amount, currency, rate.value), rate };
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
    if (postings.some((p) => Math.abs(p.usd) > LIMITS.usd)) invalid("That is too large to record");
    const at = now();
    if (isNew) {
      db.prepare(
        `
        INSERT INTO transactions
          (id, owner, kind, date, memo, rate, rate_date, rate_source, rate_currency, paid_currency, paid_amount,
           created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        rate?.currency ?? null,
        paid?.currency ?? null,
        paid?.amount ?? null,
        at,
        at,
      );
    } else {
      db.prepare(
        `
        UPDATE transactions SET kind = ?, date = ?, memo = ?, rate = ?, rate_date = ?, rate_source = ?,
          rate_currency = ?, paid_currency = ?, paid_amount = ?, updated_at = ?
        WHERE id = ? AND owner = ?
      `,
      ).run(
        kind,
        date,
        memo,
        rate?.value ?? null,
        rate?.date ?? null,
        rate?.source ?? null,
        rate?.currency ?? null,
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
    for (const { account } of postings) {
      if (accountRow(owner, account)?.currency && Math.abs(balanceOf(account)) > LIMITS.balance) {
        invalid("That would take the account past the largest balance Fafnir can keep");
      }
    }
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
    const account = usable(owner, input.account, previous);
    if (!isMoneyKind(account.kind)) invalid("Pick an account");
    const amount = checkAmount(input.amount, "The amount", account.currency as Currency);
    const other = usable(owner, input.other, previous);
    if (kind !== "moved" && (hasOwnPage(account.kind) || hasOwnPage(other.kind))) {
      invalid(
        isLoan(account.kind) || isLoan(other.kind)
          ? "A loan only takes moves and payments. Record a payment on the Loans page."
          : "Something you own only takes moves. Give it a new value on the Things I own page.",
      );
    }
    if (kind === "spent" && other.kind !== "expense") invalid("Pick a spending category");
    if (kind === "received" && other.kind !== "income") invalid("Pick an income category");
    if (kind === "moved") {
      if (!isMoneyKind(other.kind)) invalid("Pick the account the money went to");
      if (other.id === account.id) invalid("Pick two different accounts");
      if (isLoan(account.kind) && isLoan(other.kind)) invalid("Money can't move straight from one loan to another");
      if (account.kind === "asset" && other.kind === "asset") invalid("Pick an account, or a loan, for the money");
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
    // A price is for reais and dollars. Paying in a coin, or for one, is what Exchanged is for.
    if (isCoin(paidCurrency) || isCoin(currency)) invalid("Only reais and dollars can be a price");
    return { currency: paidCurrency as Currency, amount: checkAmount(amount, "The price", paidCurrency as Currency) };
  }

  /** How much of a move or an exchange went on a fee; zero if none did. It has to leave something. */
  function checkFee(kind: Entry["kind"], fee: unknown, amount: number, currency: Currency): number {
    if (fee === undefined || fee === null || fee === 0) return 0;
    if (kind !== "moved" && kind !== "exchanged") invalid("Only moves and exchanges have a fee here");
    const checked = checkAmount(fee, "The fee", currency);
    if (checked >= amount) invalid("The fee can't be all of the amount");
    return checked;
  }

  /**
   * A category Fafnir itself records to, such as fees or interest. If the user has renamed or deleted
   * it, a new one is made.
   */
  function ownCategory(owner: string, kind: CategoryKind, name: string): string {
    const row = db
      .prepare("SELECT id FROM accounts WHERE owner = ? AND kind = ? AND name = ? COLLATE NOCASE")
      .get(owner, kind, name) as { id: string } | undefined;
    if (row) return row.id;
    const id = randomUUID();
    const at = now();
    db.prepare("INSERT INTO accounts (id, owner, name, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      id,
      owner,
      name,
      kind,
      at,
      at,
    );
    return id;
  }

  /**
   * The postings of an exchange. Each currency goes through the hidden exchange account, so each adds
   * up to zero, and no rate is needed for the books to balance. `usd` is what was exchanged, without
   * the fee; the coin that arrives costs that much, and the fee is spending.
   */
  function exchangePostings(
    owner: string,
    from: { id: string; currency: Currency; amount: number },
    to: { id: string; currency: Currency; amount: number },
    usd: number,
    fee: { amount: number; usd: number },
  ): Posting[] {
    const exchange = systemAccount(owner, "exchange");
    const postings: Posting[] = [
      { account: from.id, currency: from.currency, amount: -from.amount, usd: -usd - fee.usd },
      { account: exchange, currency: from.currency, amount: from.amount - fee.amount, usd },
      { account: exchange, currency: to.currency, amount: -to.amount, usd: -usd },
      { account: to.id, currency: to.currency, amount: to.amount, usd },
    ];
    if (fee.amount > 0) {
      postings.push({
        account: ownCategory(owner, "expense", FEES),
        currency: from.currency,
        amount: fee.amount,
        usd: fee.usd,
      });
    }
    return postings;
  }

  /** What a payment on a loan, or interest added to one, is written as. `before` is the entry it replaces. */
  function loanTx(owner: string, input: NewEntry | EntryChange, date: IsoDate, before?: Entry) {
    const kind = input.kind as LoanEntryKind;
    const previous = before ? [before.account, before.other] : [];
    const account = usable(owner, input.account, previous);
    if (!isMoneyKind(account.kind)) invalid("Pick an account");
    const currency = account.currency as Currency;
    const amount = checkAmount(input.amount, "The amount", currency);
    const unchanged =
      before !== undefined &&
      before.kind === kind &&
      before.date === date &&
      before.amount === amount &&
      before.currency === currency;
    const keptOr = (same: boolean) =>
      same && input.usd === undefined
        ? { usd: before!.usd, rate: before!.rate }
        : dollars(currency, amount, date, input.usd);

    if (kind === "interest") {
      if (!isLoan(account.kind)) invalid("Pick a loan");
      const { usd, rate } = keptOr(unchanged);
      // Interest makes a debt larger and costs you, or makes what you're owed larger and earns you.
      const sign = account.kind === "borrowed" ? -1 : 1;
      const category =
        account.kind === "borrowed"
          ? ownCategory(owner, "expense", INTEREST_PAID)
          : ownCategory(owner, "income", INTEREST_EARNED);
      const postings: Posting[] = [
        { account: account.id, currency, amount: sign * amount, usd: sign * usd },
        { account: category, currency, amount: -sign * amount, usd: -sign * usd },
      ];
      return { kind, rate, paid: null, postings };
    }

    if (hasOwnPage(account.kind)) invalid("Pick the account the payment went through");
    const loan = usable(owner, input.other, previous);
    const expected: LoanKind = kind === "repaid" ? "borrowed" : "lent";
    if (loan.kind !== expected) {
      invalid(kind === "repaid" ? "Pick a loan you took" : "Pick a loan you gave");
    }
    if (loan.currency !== currency) {
      invalid("A loan is paid in its own currency. Use Exchanged first to change the money.");
    }
    const interest =
      input.interest === undefined || input.interest === 0 ? 0 : checkAmount(input.interest, "The interest", currency);
    if (interest > amount) invalid("The interest can't be more than the whole payment");

    const { usd, rate } = keptOr(unchanged && (before?.interest?.amount ?? 0) === interest);
    // Interest is worth its share of the payment, like a fee.
    const interestUsd = Math.round((usd * interest) / amount);
    const sign = kind === "repaid" ? -1 : 1;
    const postings: Posting[] = [
      { account: account.id, currency, amount: sign * amount, usd: sign * usd },
      { account: loan.id, currency, amount: -sign * (amount - interest), usd: -sign * (usd - interestUsd) },
    ];
    if (interest > 0) {
      postings.push({
        account:
          kind === "repaid"
            ? ownCategory(owner, "expense", INTEREST_PAID)
            : ownCategory(owner, "income", INTEREST_EARNED),
        currency,
        amount: -sign * interest,
        usd: -sign * interestUsd,
      });
    }
    return { kind, rate, paid: null, postings };
  }

  /** What an entry is written as. `before` is the entry it replaces. */
  function everydayTx(owner: string, input: NewEntry | EntryChange, date: IsoDate, before?: Entry) {
    if (isLoanEntry(input.kind)) return loanTx(owner, input, date, before);
    const { kind, account, other, amount } = everydayPostings(
      owner,
      input,
      before ? [before.account, before.other] : [],
    );
    const currency = account.currency as Currency;
    const fee = checkFee(kind, input.fee, amount, currency);
    const feeBefore = before?.fee?.amount ?? 0;

    if (kind === "exchanged") {
      const toCurrency = other.currency as Currency;
      const arrived = checkAmount(input.arrived, "What arrived", toCurrency);
      const net = amount - fee;
      // Dollars stay as they were saved unless what they depend on changed.
      const same =
        before?.kind === "exchanged" &&
        before.date === date &&
        before.currency === currency &&
        before.amount === amount &&
        before.arrived?.currency === toCurrency &&
        before.arrived.amount === arrived &&
        feeBefore === fee &&
        input.usd === undefined;
      const side = VALUE_ORDER.find((c) => c === currency || c === toCurrency)!;
      const { usd, rate } = same
        ? { usd: before.usd - (before.fee?.usd ?? 0), rate: before.rate }
        : dollars(side, side === currency ? net : arrived, date, input.usd);
      // The fee is worth its share of the trade, which needs no second rate.
      const feeUsd = Math.round((usd * fee) / net);
      const postings = exchangePostings(
        owner,
        { id: account.id, currency, amount },
        { id: other.id, currency: toCurrency, amount: arrived },
        usd,
        { amount: fee, usd: feeUsd },
      );
      return { kind, rate, paid: null, postings };
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
        before?.paid === null &&
        before.kind !== "exchanged" &&
        before.date === date &&
        before.amount === amount &&
        before.currency === currency &&
        feeBefore === fee;
      ({ usd, rate } =
        same && input.usd === undefined
          ? { usd: before.usd, rate: before.rate }
          : dollars(currency, amount, date, input.usd));
    }
    const postings = postingsOf(kind, account.id, other.id, currency, amount, usd);
    if (fee > 0) {
      // What was sent is worth all of `usd`. Less of it arrives, and the rest went on the fee.
      const feeUsd = Math.round((usd * fee) / amount);
      postings[1] = { account: other.id, currency, amount: amount - fee, usd: usd - feeUsd };
      postings.push({ account: ownCategory(owner, "expense", FEES), currency, amount: fee, usd: feeUsd });
    }
    return { kind, rate, paid, postings };
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

  /**
   * Records what something the user owns is worth on a day, as an entry for the difference. Null if
   * the value hasn't changed. It runs inside the caller's transaction.
   */
  function revalue(
    owner: string,
    asset: AccountRow,
    id: string,
    date: IsoDate,
    value: number,
    typed: unknown,
  ): { before: number; entry: Entry | null } {
    const currency = asset.currency as Currency;
    const before = balanceOf(asset.id, date);
    const difference = value - before;
    if (difference === 0) return { before, entry: null };
    if (Math.abs(difference) > CURRENCY_INFO[currency].largest) invalid("The difference is too large");
    roomForEntries(owner);
    const { usd, rate } = dollars(currency, difference, date, typed);
    const other = systemAccount(owner, "revaluation");
    writeTx(
      owner,
      id,
      "revalued",
      date,
      "",
      rate,
      postingsOf("revalued", asset.id, other, currency, difference, usd),
      true,
    );
    return { before, entry: readEntry(owner, id)! };
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

  /** Which part of what the user is worth a balance belongs to. Anything below zero is owed. */
  function partOf(kind: MoneyKind, usd: number): WorthPart {
    if (usd < 0 || kind === "card" || kind === "borrowed") return usd < 0 ? "debts" : "money";
    if (kind === "crypto") return "crypto";
    if (kind === "asset") return "owned";
    if (kind === "lent") return "lent";
    return "money";
  }

  /** What an amount is worth in US cents on a day; null if it needs a rate nobody knows. */
  function valueOn(amount: number, currency: Currency, date: IsoDate): number | null {
    if (currency === "USD") return amount;
    const rate = lookupRate(currency, date);
    return rate ? usdCents(amount, currency, rate.value) : null;
  }

  /** What the user was worth at the end of a day, at that day's rate; null if the rate is needed and unknown. */
  function worthOn(owner: string, date: IsoDate): number | null {
    return worthByKind(owner, date)?.total ?? null;
  }

  /** What the user was worth at the end of a day, split into its parts; null if a rate is needed and unknown. */
  function worthByKind(owner: string, date: IsoDate): { parts: Record<WorthPart, number>; total: number } | null {
    const rows = db
      .prepare(
        `
        SELECT a.kind AS kind, a.currency AS currency, SUM(p.amount) AS balance
        FROM postings p
        JOIN transactions t ON t.id = p.tx_id
        JOIN accounts a ON a.id = p.account_id
        WHERE t.owner = ? AND t.date <= ? AND a.currency IS NOT NULL
        GROUP BY a.id
      `,
      )
      .all(owner, date) as unknown as { kind: MoneyKind; currency: Currency; balance: number }[];
    const parts: Record<WorthPart, number> = { money: 0, crypto: 0, owned: 0, lent: 0, debts: 0 };
    let total = 0;
    for (const { kind, currency, balance } of rows) {
      if (balance === 0) continue;
      const usd = valueOn(balance, currency, date);
      if (usd === null) return null;
      parts[partOf(kind, usd)] += usd;
      total += usd;
    }
    return { parts, total };
  }

  function worthChange(owner: string, month: string, moneyIn: number, moneyOut: number): WorthChange | null {
    const { start: startDay, end: endDay } = monthSpan(month);
    if (startDay >= endDay) return null;
    const start = worthOn(owner, startDay);
    const end = worthOn(owner, endDay);
    if (start === null || end === null) return null;
    const { added, revalued } = db
      .prepare(
        `
        SELECT COALESCE(SUM(CASE WHEN t.kind <> 'revalued' THEN p.usd END), 0) AS added,
               COALESCE(SUM(CASE WHEN t.kind = 'revalued' THEN p.usd END), 0) AS revalued
        FROM transactions t JOIN postings p ON p.tx_id = t.id AND p.seq = 0
        WHERE t.owner = ? AND t.date > ? AND t.date <= ? AND t.kind IN ('starting', 'adjustment', 'revalued')
      `,
      )
      .get(owner, startDay, endDay) as { added: number; revalued: number };
    return { start, end, added, revalued, rates: end - start - moneyIn + moneyOut - added - revalued };
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
          SELECT a.*, COUNT(p.tx_id) AS entries,
                 COALESCE(SUM(CASE WHEN a.currency IS NOT NULL THEN p.amount END), 0) AS balance
          FROM accounts a LEFT JOIN postings p ON p.account_id = a.id
          WHERE a.owner = ? AND a.kind NOT IN ('starting', 'adjustment', 'exchange', 'revaluation')
          GROUP BY a.id
          ORDER BY a.grp COLLATE NOCASE, a.name COLLATE NOCASE
        `,
        )
        .all(owner) as unknown as (AccountRow & { balance: number })[];

      const date = today();
      const rates = {
        BRL: lookupRate("BRL", date),
        BTC: lookupRate("BTC", date),
        ICP: lookupRate("ICP", date),
        USDC: lookupRate("USDC", date),
      };
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
          const usdNow = valueOn(row.balance, currency, date);
          if (usdNow === null) missingRate ||= row.balance !== 0;
          else if (usdNow >= 0) have += usdNow;
          else owe -= usdNow;
          accounts.push({ ...base, kind: row.kind, currency, balance: row.balance, usdNow });
        } else {
          categories.push({ ...base, kind: row.kind as CategoryKind, currency: null });
        }
      }
      return { accounts, categories, rates, have, owe, missingRate, month: monthSummary(owner, month) };
    },

    holdings(owner) {
      ensureBook(owner);
      // Oldest first, and each transaction once per coin: a move between two of the user's own
      // accounts adds up to nothing but its fee.
      const changes = db
        .prepare(
          `
          SELECT p.currency AS coin, t.kind AS kind, SUM(p.amount) AS amount, SUM(p.usd) AS usd
          FROM transactions t
          JOIN postings p ON p.tx_id = t.id
          JOIN accounts a ON a.id = p.account_id
          WHERE t.owner = ? AND a.kind = 'crypto'
          GROUP BY t.id, p.currency
          ORDER BY t.date, t.created_at
        `,
        )
        .all(owner) as unknown as CoinChange[];
      const costs = coinCosts(changes);

      const accounts = db
        .prepare(
          `
          SELECT a.id AS id, a.name AS name, a.currency AS coin, COALESCE(SUM(p.amount), 0) AS balance
          FROM accounts a LEFT JOIN postings p ON p.account_id = a.id
          WHERE a.owner = ? AND a.kind = 'crypto'
          GROUP BY a.id
          ORDER BY a.name COLLATE NOCASE
        `,
        )
        .all(owner) as unknown as { id: string; name: string; coin: Coin; balance: number }[];

      const date = today();
      const holdings = COINS.filter((coin) => costs.has(coin) || accounts.some((a) => a.coin === coin)).map((coin) => {
        const { quantity, cost, realized, short } = costs.get(coin) ?? {
          quantity: 0,
          cost: 0,
          realized: 0,
          short: false,
        };
        return {
          coin,
          quantity,
          price: lookupRate(coin, date),
          value: valueOn(quantity, coin, date),
          cost,
          realized,
          short,
          accounts: accounts.filter((a) => a.coin === coin).map(({ id, name, balance }) => ({ id, name, balance })),
        };
      });
      return { holdings };
    },

    loans(owner) {
      ensureBook(owner);
      const rows = db
        .prepare(
          `
          SELECT a.id, a.name, a.kind, a.currency, a.closed, COUNT(p.tx_id) AS entries,
                 COALESCE(SUM(p.amount), 0) AS balance
          FROM accounts a LEFT JOIN postings p ON p.account_id = a.id
          WHERE a.owner = ? AND a.kind IN ('borrowed', 'lent')
          GROUP BY a.id
          ORDER BY a.name COLLATE NOCASE
        `,
        )
        .all(owner) as unknown as {
        id: string;
        name: string;
        kind: LoanKind;
        currency: Currency;
        closed: number;
        entries: number;
        balance: number;
      }[];

      const date = today();
      const loans = new Map<string, LoanSummary>();
      for (const row of rows) {
        // What is owed, seen from the loan's side: above zero until it has been paid beyond that.
        const owed = row.kind === "borrowed" ? -row.balance : row.balance;
        loans.set(row.id, {
          id: row.id,
          name: row.name,
          kind: row.kind,
          currency: row.currency,
          closed: row.closed === 1,
          entries: row.entries,
          left: Math.max(0, owed),
          overpaid: Math.max(0, -owed),
          usdLeft: valueOn(Math.max(0, owed), row.currency, date),
          taken: 0,
          paidOff: 0,
          interest: 0,
          lastPayment: null,
          lastTotal: null,
        });
      }
      if (loans.size === 0) return { loans: [] };

      // Oldest first, so the last payment seen is the last one made.
      for (const entry of this.allEntries(owner)) {
        const from = loans.get(entry.account);
        const to = entry.other ? loans.get(entry.other) : undefined;
        if (!from && !to) continue;
        switch (entry.kind) {
          case "starting":
            from!.taken += Math.abs(entry.amount);
            break;
          case "interest":
            from!.interest += entry.amount;
            break;
          case "repaid":
          case "collected": {
            const interest = entry.interest?.amount ?? 0;
            to!.paidOff += entry.amount - interest;
            to!.interest += interest;
            to!.lastPayment = entry.date;
            to!.lastTotal = entry.amount;
            break;
          }
          case "moved": {
            // Into a debt or out of what you're owed is paying it off; the other way is more of it.
            const arrives = entry.amount - (entry.fee?.amount ?? 0);
            if (to?.kind === "borrowed") {
              to.paidOff += arrives;
              to.lastPayment = entry.date;
            }
            if (to?.kind === "lent") to.taken += arrives;
            if (from?.kind === "borrowed") from.taken += entry.amount;
            if (from?.kind === "lent") {
              from.paidOff += entry.amount;
              from.lastPayment = entry.date;
            }
            break;
          }
          default:
            break;
        }
      }
      return { loans: [...loans.values()] };
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
        if (before.kind === "revalued") conflict("A new value can't be changed, only deleted");
        if ((input.kind === "starting") !== (before.kind === "starting")) {
          invalid("A starting balance can't become another kind of entry");
        }
        const date = checkDate(input.date);
        const memo = checkText(input.memo, "The note", LIMITS.memo);

        if (before.kind === "starting") {
          const amount = checkAmount(input.amount, "The amount", before.currency, true);
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
        if ((input.kind === "crypto") !== isCoin(input.currency)) {
          invalid("A crypto account holds a coin, and only a crypto account can");
        }
        const group = checkText(input.group, "The group", LIMITS.group);
        const starting =
          input.starting === undefined ? 0 : checkAmount(input.starting, "The balance", input.currency, true);
        if (input.kind === "asset" && starting < 0) invalid("Something you own can't be worth less than nothing");
        if ((input.kind === "borrowed" && starting > 0) || (input.kind === "lent" && starting < 0)) {
          invalid("A loan you took starts at what you owe, and one you gave at what you're owed");
        }
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
          if ((input.kind === "crypto") !== isCoin(row.currency)) {
            invalid("A crypto account holds a coin, and only a crypto account can");
          }
          if ((hasOwnPage(row.kind) || hasOwnPage(input.kind)) && input.kind !== row.kind) {
            invalid(
              row.kind === "asset" || input.kind === "asset"
                ? "Something you own stays that, and an account stays an account"
                : "A loan stays a loan, and which way it goes can't change",
            );
          }
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
        const currency = account.currency as Currency;
        const actual = checkAmount(input.actual, "The balance", currency, true);
        const recorded = balanceOf(accountId, date);
        const difference = actual - recorded;
        if (difference === 0) return { recorded, entry: null };
        if (Math.abs(difference) > CURRENCY_INFO[currency].largest) invalid("The difference is too large");
        roomForEntries(owner);
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

    setValue(owner, assetId, input) {
      const id = checkId(input.id);
      return transaction(db, () => {
        const asset = accountRow(owner, assetId);
        if (!asset || asset.kind !== "asset") notFound("thing you own");
        const date = checkDate(input.date);
        const existing = readEntry(owner, id);
        if (existing) return { before: balanceOf(assetId, date) - existing.amount, entry: existing };
        if (db.prepare("SELECT 1 FROM transactions WHERE id = ?").get(id)) invalid("That id isn't valid");
        if (asset.closed) invalid(`${asset.name} has been sold`);
        const value = checkAmount(input.value, "The value", asset.currency as Currency, true);
        if (value < 0) invalid("Something you own can't be worth less than nothing");
        return revalue(owner, asset, id, date, value, input.usd);
      });
    },

    sell(owner, assetId, input) {
      const id = checkId(input.id);
      const valueId = checkId(input.valueId);
      if (id === valueId) invalid("That id isn't valid");
      transaction(db, () => {
        const asset = accountRow(owner, assetId);
        if (!asset || asset.kind !== "asset") notFound("thing you own");
        // Sent twice (the first answer got lost): the first one stands.
        if (readEntry(owner, id)) return;
        for (const taken of [id, valueId]) {
          if (db.prepare("SELECT 1 FROM transactions WHERE id = ?").get(taken)) invalid("That id isn't valid");
        }
        if (asset.closed) invalid(`${asset.name} has already been sold`);
        const currency = asset.currency as Currency;
        const date = checkDate(input.date);
        const amount = checkAmount(input.amount, "The price", currency, true);
        if (amount < 0) invalid("The price can't be below zero");
        const account = usable(owner, input.account);
        if (!isMoneyKind(account.kind) || hasOwnPage(account.kind)) invalid("Pick the account the money went to");
        if (account.currency !== currency) {
          invalid("It's sold in its own currency. Use Exchanged afterwards to change the money.");
        }
        // Its value becomes what it sold for, then that much leaves it: nothing is left behind.
        revalue(owner, asset, valueId, date, amount, undefined);
        if (amount > 0) {
          roomForEntries(owner);
          const { usd, rate } = dollars(currency, amount, date, undefined);
          writeTx(
            owner,
            id,
            "moved",
            date,
            "",
            rate,
            postingsOf("moved", asset.id, account.id, currency, amount, usd),
            true,
          );
        }
        if (balanceOf(asset.id) !== 0) {
          conflict(`${asset.name} has entries after that day. Sell it on the day of its last entry, or later.`);
        }
        db.prepare("UPDATE accounts SET closed = 1, updated_at = ? WHERE id = ? AND owner = ?").run(
          now(),
          asset.id,
          owner,
        );
      });
    },

    assets(owner) {
      ensureBook(owner);
      const rows = db
        .prepare(
          `
          SELECT a.id, a.name, a.currency, a.closed, COUNT(p.tx_id) AS entries, COALESCE(SUM(p.amount), 0) AS balance
          FROM accounts a LEFT JOIN postings p ON p.account_id = a.id
          WHERE a.owner = ? AND a.kind = 'asset'
          GROUP BY a.id
          ORDER BY a.name COLLATE NOCASE
        `,
        )
        .all(owner) as unknown as {
        id: string;
        name: string;
        currency: Currency;
        closed: number;
        entries: number;
        balance: number;
      }[];
      if (rows.length === 0) return { assets: [] };

      const date = today();
      const assets = new Map<string, AssetSummary>();
      for (const row of rows) {
        assets.set(row.id, {
          id: row.id,
          name: row.name,
          currency: row.currency,
          closed: row.closed === 1,
          entries: row.entries,
          value: row.balance,
          usdValue: valueOn(row.balance, row.currency, date),
          paid: 0,
          owned: 0,
          changes: 0,
          sold: 0,
          updated: null,
        });
      }
      // Oldest first, so the last date seen is the last update.
      for (const entry of this.allEntries(owner)) {
        const into = entry.other ? assets.get(entry.other) : undefined;
        const out = assets.get(entry.account);
        if (entry.kind === "moved" && into) {
          into.paid += entry.amount - (entry.fee?.amount ?? 0);
          into.updated = entry.date;
        }
        if (!out) continue;
        if (entry.kind === "moved") out.sold += entry.amount;
        if (entry.kind === "starting" || entry.kind === "adjustment") out.owned += entry.amount;
        if (entry.kind === "revalued") out.changes += entry.amount;
        out.updated = entry.date;
      }
      return { assets: [...assets.values()] };
    },

    firstMonth(owner) {
      const row = db.prepare("SELECT MIN(date) AS first FROM transactions WHERE owner = ?").get(owner) as {
        first: string | null;
      };
      return row.first ? row.first.slice(0, 7) : null;
    },

    worthHistory(owner) {
      ensureBook(owner);
      const first = this.firstMonth(owner);
      if (!first) return { points: [] };
      const points: WorthPoint[] = [];
      const last = today().slice(0, 7);
      for (let month = first; month <= last; month = nextMonth(month)) {
        const { end: date } = monthSpan(month);
        const worth = worthByKind(owner, date);
        points.push({ month, date, parts: worth?.parts ?? null, total: worth?.total ?? null });
      }
      return { points };
    },

    spendingMonths(owner, month, count) {
      if (!isMonth(month)) invalid("That month isn't valid");
      if (!Number.isSafeInteger(count) || count < 1 || count > 36) invalid("That many months isn't possible");
      ensureBook(owner);
      const months: string[] = [];
      for (let m = month, i = 0; i < count; i++, m = previousMonth(m)) months.unshift(m);
      const rows = db
        .prepare(
          `
          SELECT substr(t.date, 1, 7) AS month, a.id AS category, a.kind AS kind, SUM(p.usd) AS usd
          FROM postings p
          JOIN transactions t ON t.id = p.tx_id
          JOIN accounts a ON a.id = p.account_id
          WHERE t.owner = ? AND t.date BETWEEN ? AND ? AND a.kind IN ('expense', 'income')
          GROUP BY month, a.id
        `,
        )
        .all(owner, `${months[0]}-01`, `${month}-31`) as unknown as {
        month: string;
        category: string;
        kind: CategoryKind;
        usd: number;
      }[];
      const at = new Map(months.map((m, i) => [m, i]));
      const byCategory = new Map<string, number[]>();
      const moneyIn = months.map(() => 0);
      const moneyOut = months.map(() => 0);
      for (const row of rows) {
        const i = at.get(row.month)!;
        if (row.kind === "income") {
          moneyIn[i]! -= row.usd;
          continue;
        }
        if (row.usd === 0) continue;
        const line = byCategory.get(row.category) ?? months.map(() => 0);
        line[i] = row.usd;
        byCategory.set(row.category, line);
        moneyOut[i]! += row.usd;
      }
      // The biggest over all the months first.
      const categories = [...byCategory]
        .map(([category, usd]) => ({ category, usd }))
        .sort((a, b) => b.usd.reduce((x, y) => x + y, 0) - a.usd.reduce((x, y) => x + y, 0));
      return { months, categories, moneyIn, moneyOut };
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
