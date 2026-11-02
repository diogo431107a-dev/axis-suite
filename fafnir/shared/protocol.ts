// The API's wire format, used by the server and the page.
import type { Coin, Currency } from "./currencies.ts";

export { CURRENCIES, type Currency } from "./currencies.ts";

/** A page names the user whose money it shows, so its changes can't land on someone else's. */
export const USER_HEADER = "X-Fafnir-User";

export const LIMITS = {
  name: 100,
  group: 100,
  memo: 500,
  accountsPerUser: 500,
  entriesPerUser: 100_000,
  /**
   * The largest value of one entry, in US cents. With entriesPerUser it keeps every sum of dollars
   * well inside what a JavaScript number holds exactly.
   */
  usd: 50_000_000_000,
  /**
   * The largest balance an account can reach, in its smallest unit. Eight decimals leave too little
   * room for a limit per entry to protect the sums, so a balance is checked as it changes.
   */
  balance: 4_000_000_000_000_000,
  entriesPerPage: 100,
} as const;

/**
 * Places the user's money is. A card's balance is normally below zero: what is owed on it. "crypto"
 * holds a coin and nothing else, and the others hold reais or dollars. A loan is an account too: what
 * was borrowed is below zero, what was lent above it.
 */
export const LOAN_KINDS = ["borrowed", "lent"] as const;
export type LoanKind = (typeof LOAN_KINDS)[number];
export const isLoan = (kind: unknown): kind is LoanKind => LOAN_KINDS.includes(kind as LoanKind);

export const MONEY_KINDS = ["cash", "bank", "savings", "card", "crypto", ...LOAN_KINDS, "asset"] as const;
export type MoneyKind = (typeof MONEY_KINDS)[number];

/**
 * Loans and things the user owns ("asset", a car or a house at a value they type) each have a page of
 * their own, and stay out of the everyday forms.
 */
export const hasOwnPage = (kind: unknown): boolean => isLoan(kind) || kind === "asset";
export const CATEGORY_KINDS = ["expense", "income"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

/** Dates are the user's calendar day, YYYY-MM-DD. */
export type IsoDate = string;

export interface Account {
  /** Made by the browser; made by the server for the categories every new user starts with. */
  id: string;
  name: string;
  kind: MoneyKind | CategoryKind;
  /** Null on a category: it takes entries in any currency. */
  currency: Currency | null;
  /** Keeps accounts together on the page ("Coinbase"). Empty for none. */
  group: string;
  closed: boolean;
  /** How many entries use it. Only an account with none can be deleted. */
  entries: number;
}

/** A place the user's money is, as the page shows it. */
export interface MoneyAccount extends Account {
  kind: MoneyKind;
  currency: Currency;
  /** In the smallest unit of its own currency. */
  balance: number;
  /** What the balance is worth in US cents at the latest rate or price; null while none is known. */
  usdNow: number | null;
}

/** The currencies with a rate: all but the US dollar, which everything is measured in. */
export type RatedCurrency = Exclude<Currency, "USD">;

/** The source of USDC's rate while it counts as exactly one dollar. */
export const USDC_PEG = "Counted as $1";

export interface Rate {
  currency: RatedCurrency;
  /** For BRL, reais for one US dollar. For a coin, US dollars for one coin. */
  value: number;
  /** The day it is the rate of. It can be earlier than the day asked for: weekends have none. */
  date: IsoDate;
  source: string;
}

export const ENTRY_KINDS = ["spent", "received", "moved", "exchanged"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

/**
 * What happens to a loan. "repaid" is you paying a debt, "collected" is someone paying you, and
 * "interest" makes a loan's balance grow with no money moving.
 */
export const LOAN_ENTRY_KINDS = ["repaid", "collected", "interest"] as const;
export type LoanEntryKind = (typeof LOAN_ENTRY_KINDS)[number];
export const isLoanEntry = (kind: unknown): kind is LoanEntryKind => LOAN_ENTRY_KINDS.includes(kind as LoanEntryKind);

/** An amount in a currency other than the account's. */
export interface Foreign {
  currency: Currency;
  /** In the currency's smallest unit. */
  amount: number;
}

/** A fee taken out of a move or an exchange, or the interest in a loan payment. */
export interface Fee extends Foreign {
  /** What it was worth in US cents. */
  usd: number;
}

export interface Entry {
  id: string;
  /** "starting" and "adjustment" are made by adding an account and by Check balance. */
  /** "revalued" is a new value typed for something the user owns. */
  kind: EntryKind | LoanEntryKind | "starting" | "adjustment" | "revalued";
  date: IsoDate;
  memo: string;
  /**
   * The account the money left (spent, moved) or reached (received); the one a balance is for. On
   * "repaid" and "collected" it is the account that paid or got paid, and on "interest" the loan.
   */
  account: string;
  /**
   * The category, or where a move or exchange went. On "repaid" and "collected" it is the loan. Null on
   * "starting" and "adjustment".
   */
  other: string | null;
  currency: Currency;
  /**
   * What left or arrived, in the smallest unit, with any fee included. Above zero, except on "starting"
   * and "adjustment", where it can be either.
   */
  amount: number;
  /** What it was worth in US cents on the day, with any fee included: set when it is saved, and it stays. */
  usd: number;
  /** The rate or price behind `usd`. Null if it was in dollars, or the user typed the dollars. */
  rate: Rate | null;
  /** On spent and received: the price in the other currency, if that's what it was in. */
  paid: Foreign | null;
  /** On exchanged: what arrived in the other account. */
  arrived: Foreign | null;
  /** On moved and exchanged: the part of `amount` that went on a fee. */
  fee: Fee | null;
  /** On repaid and collected: the part of `amount` that was interest. */
  interest: Fee | null;
}

export interface NewEntry {
  /** Made by the browser, so sending the same entry twice saves it once. */
  id: string;
  kind: EntryKind | LoanEntryKind;
  date: IsoDate;
  memo?: string;
  account: string;
  /** Not on "interest", where Fafnir picks the category. */
  other?: string;
  amount: number;
  /** The dollars, typed by the user instead of worked out from the rate. */
  usd?: number;
  /** Spent or received in the other currency; `amount` is then what the account was charged or got. */
  paid?: Foreign;
  /** Required on exchanged: what arrived, in the smallest unit of the `other` account's currency. */
  arrived?: number;
  /** On moved and exchanged: how much of `amount` went on a fee, in the same currency. */
  fee?: number;
  /** On repaid and collected: how much of `amount` was interest, in the same currency. */
  interest?: number;
}

/** Changing an entry. "starting" takes only a date, an amount (which can be below zero) and a memo. */
export interface EntryChange extends Omit<NewEntry, "kind" | "id"> {
  kind: EntryKind | LoanEntryKind | "starting";
}

export interface NewAccount {
  id: string;
  name: string;
  kind: MoneyKind;
  currency: Currency;
  group?: string;
  /** What is in it now, in its smallest unit; below zero for what is owed. Zero or left out for nothing. */
  starting?: number;
  /** Required with `starting`. */
  date?: IsoDate;
  usd?: number;
}

export interface NewCategory {
  id: string;
  name: string;
  kind: CategoryKind;
}

export interface AccountChange {
  name?: string;
  group?: string;
  /** Only between the kinds of money, not between money and a category. */
  kind?: MoneyKind;
  closed?: boolean;
}

/** Check balance: the balance the bank shows. */
export interface BalanceCheck {
  /** Made by the browser, like an entry's: it becomes the adjustment's id. */
  id: string;
  date: IsoDate;
  /** In the smallest unit; below zero for what is owed. */
  actual: number;
  usd?: number;
}

/** A new value for something the user owns. */
export interface NewValue {
  /** Made by the browser, like an entry's: it becomes the entry's id. */
  id: string;
  date: IsoDate;
  /** What it's worth now, in the smallest unit. */
  value: number;
  usd?: number;
}

export interface NewValueResult {
  /** What it was worth before, on that day. */
  before: number;
  /** The entry for the difference; null if the value hadn't changed. */
  entry: Entry | null;
}

/** Selling something the user owns: its value becomes the price, the money moves, and it closes. */
export interface Sale {
  /** The move's id, made by the browser. */
  id: string;
  /** The new value's id, made by the browser. */
  valueId: string;
  /** Where the money went. */
  account: string;
  /** What it sold for, in the smallest unit. */
  amount: number;
  date: IsoDate;
}

export interface BalanceCheckResult {
  /** What Fafnir had recorded on that day, in the smallest unit. */
  recorded: number;
  /** The adjustment that makes up the difference; null if there was none. */
  entry: Entry | null;
}

export interface CategoryTotal {
  category: string;
  /** In US cents. */
  usd: number;
}

/** One month's money, in US cents at the rates of the days it happened. */
export interface MonthSummary {
  month: string;
  moneyIn: number;
  moneyOut: number;
  spending: CategoryTotal[];
  /** Why what the user is worth changed; null if a rate it needs isn't known. */
  change: WorthChange | null;
}

/** end = start + moneyIn - moneyOut + added + revalued + rates, all in US cents. */
export interface WorthChange {
  /** What the user was worth as the month began, at that day's rate. */
  start: number;
  /** What the user was worth as it ended (or today), at that day's rate. */
  end: number;
  /** Starting balances and balance checks. */
  added: number;
  /** New values typed for things the user owns. */
  revalued: number;
  /** What's left: reais and coins worth more or fewer dollars, and what exchanging cost. */
  rates: number;
}

export interface Book {
  accounts: MoneyAccount[];
  categories: Account[];
  /** The latest rate and prices known; null where none has ever been fetched. */
  rates: Record<RatedCurrency, Rate | null>;
  /** All in US cents at the latest rates. */
  have: number;
  owe: number;
  /** Whether a balance is left out of those because no rate is known. */
  missingRate: boolean;
  month: MonthSummary;
}

/** One coin, across all of a user's accounts. All dollars are in US cents. */
export interface Holding {
  coin: Coin;
  /** In the coin's smallest unit. */
  quantity: number;
  /** Today's price; null while none is known. */
  price: Rate | null;
  /** What the quantity is worth now; null while no price is known. */
  value: number | null;
  /** What the quantity cost, at the average of what was paid. */
  cost: number;
  /** What selling or spending it made beyond what it cost. */
  realized: number;
  /** More has gone out than was ever recorded coming in, so its cost is too low. */
  short: boolean;
  /** Where it sits. */
  accounts: { id: string; name: string; balance: number }[];
}

export interface Holdings {
  holdings: Holding[];
}

/** One loan, read from its entries. Amounts are in its own currency, in the smallest unit. */
export interface LoanSummary {
  id: string;
  name: string;
  kind: LoanKind;
  currency: Currency;
  closed: boolean;
  /** How many entries use it. Only a loan with none can be deleted. */
  entries: number;
  /** What's still owed, never below zero. */
  left: number;
  /** What has been paid beyond the whole loan. */
  overpaid: number;
  /** What `left` is worth in US cents at the latest rate; null while none is known. */
  usdLeft: number | null;
  /** What was borrowed or lent, including what was already owed when it was added. */
  taken: number;
  /** What has come off it, without the interest. */
  paidOff: number;
  /** Interest so far: in payments, and added with no payment. */
  interest: number;
  /** The last day anything was paid. Null if nothing has been. */
  lastPayment: IsoDate | null;
  /** The total of the last payment, to suggest for the next one. Null if there has been none. */
  lastTotal: number | null;
}

export interface Loans {
  loans: LoanSummary[];
}

/** Something the user owns, read from its entries. Amounts are in its own currency, in the smallest unit. */
export interface AssetSummary {
  id: string;
  name: string;
  currency: Currency;
  closed: boolean;
  entries: number;
  /** What it's worth, as last typed. */
  value: number;
  /** `value` in US cents at the latest rate; null while none is known. */
  usdValue: number | null;
  /** What was paid for it, through the user's accounts or a loan. Zero if it was added as already owned. */
  paid: number;
  /** Its value when it was added as already owned. Zero if it was bought. */
  owned: number;
  /** All the new values typed for it, added up: below zero if it has lost value. */
  changes: number;
  /** What it sold for. */
  sold: number;
  /** The last day it was bought, added, sold or given a new value. */
  updated: IsoDate | null;
}

export interface Assets {
  assets: AssetSummary[];
}

/**
 * The parts of what the user is worth: money in hand (cash, bank, savings), crypto, things they own,
 * what they're owed, and debts. Any balance below zero counts as a debt, whatever its account.
 */
export const WORTH_PARTS = ["money", "crypto", "owned", "lent", "debts"] as const;
export type WorthPart = (typeof WORTH_PARTS)[number];

/** What the user was worth at the end of a month (or today), at that day's rates, in US cents. */
export interface WorthPoint {
  month: string;
  date: IsoDate;
  /** Null when a rate it needs isn't known. Debts are below zero. */
  parts: Record<WorthPart, number> | null;
  total: number | null;
}

export interface WorthHistory {
  /** Oldest first, from the month of the first entry to this one. */
  points: WorthPoint[];
}

/** A spending category's limit for a month, in the currency the user thinks of it in. */
export interface Budget {
  currency: "USD" | "BRL";
  /** In the currency's smallest unit. */
  amount: number;
  /** The month it was set from; it holds until it is changed. */
  from: string;
}

/** One spending category in a month: its budget, if any, and what was spent. */
export interface BudgetLine {
  category: string;
  budget: Budget | null;
  /** In the budget's currency (US cents without a budget). */
  spent: number;
  /** In US cents, at the rates of the days it was spent. */
  spentUsd: number;
  /** Some spending couldn't be put into reais for want of a rate, so `spent` leaves it out. */
  missingRate: boolean;
}

export interface Budgets {
  month: string;
  lines: BudgetLine[];
}

/** Setting a budget from a month on. A null amount removes it from that month on. */
export interface BudgetChange {
  month: string;
  currency: "USD" | "BRL";
  amount: number | null;
}

/** Several months of spending and income side by side, oldest first, in US cents. */
export interface SpendingMonths {
  months: string[];
  /** Each spending category with anything in those months; `usd` lines up with `months`. */
  categories: { category: string; usd: number[] }[];
  moneyIn: number[];
  moneyOut: number[];
}

export interface EntryPage {
  entries: Entry[];
  /** How many entries match, on all pages. */
  total: number;
}

export type ErrorCode = "invalid" | "not-found" | "too-many" | "conflict" | "no-rate" | "other-user";

export interface ApiError {
  error: string;
  code?: ErrorCode;
}
