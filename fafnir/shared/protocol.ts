// The API's wire format, used by the server and the page.

/** A page names the user whose money it shows, so its changes can't land on someone else's. */
export const USER_HEADER = "X-Fafnir-User";

export const LIMITS = {
  name: 100,
  group: 100,
  memo: 500,
  accountsPerUser: 500,
  entriesPerUser: 100_000,
  /**
   * The largest amount of one entry, in cents. With entriesPerUser it keeps every sum well inside
   * what a JavaScript number holds exactly.
   */
  amount: 50_000_000_000,
  entriesPerPage: 100,
} as const;

export const CURRENCIES = ["USD", "BRL"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Places the user's money is. A card's balance is normally below zero: what is owed on it. */
export const MONEY_KINDS = ["cash", "bank", "savings", "card"] as const;
export type MoneyKind = (typeof MONEY_KINDS)[number];
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
  /** In cents of its own currency. */
  balance: number;
  /** What the balance is worth in US cents at the latest rate; null while no rate is known. */
  usdNow: number | null;
}

export interface Rate {
  /** Reais for one US dollar. */
  value: number;
  /** The day it is the rate of. It can be earlier than the day asked for: weekends have none. */
  date: IsoDate;
  source: string;
}

export const ENTRY_KINDS = ["spent", "received", "moved", "exchanged"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

/** An amount in a currency other than the account's. */
export interface Foreign {
  currency: Currency;
  /** In cents. */
  amount: number;
}

export interface Entry {
  id: string;
  /** "starting" and "adjustment" are made by adding an account and by Check balance. */
  kind: EntryKind | "starting" | "adjustment";
  date: IsoDate;
  memo: string;
  /** The account the money left (spent, moved) or reached (received); the one a balance is for. */
  account: string;
  /** The category, or where a move or exchange went. Null on "starting" and "adjustment". */
  other: string | null;
  currency: Currency;
  /** In cents. Above zero, except on "starting" and "adjustment", where it can be either. */
  amount: number;
  /** What it was worth in US cents on the day: set when it is saved, and it stays. */
  usd: number;
  /** The rate behind `usd`. Null if it was in dollars, or the user typed the dollars. */
  rate: Rate | null;
  /** On spent and received: the price in the other currency, if that's what it was in. */
  paid: Foreign | null;
  /** On exchanged: what arrived in the other account. */
  arrived: Foreign | null;
}

export interface NewEntry {
  /** Made by the browser, so sending the same entry twice saves it once. */
  id: string;
  kind: EntryKind;
  date: IsoDate;
  memo?: string;
  account: string;
  other: string;
  amount: number;
  /** The dollars, typed by the user instead of worked out from the rate. */
  usd?: number;
  /** Spent or received in the other currency; `amount` is then what the account was charged or got. */
  paid?: Foreign;
  /** Required on exchanged: what arrived, in cents of the `other` account's currency. */
  arrived?: number;
}

/** Changing an entry. "starting" takes only a date, an amount (which can be below zero) and a memo. */
export interface EntryChange extends Omit<NewEntry, "kind" | "other" | "id"> {
  kind: EntryKind | "starting";
  other?: string;
}

export interface NewAccount {
  id: string;
  name: string;
  kind: MoneyKind;
  currency: Currency;
  group?: string;
  /** What is in it now, in cents; below zero for what is owed. Zero or left out for nothing. */
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
  /** In cents; below zero for what is owed. */
  actual: number;
  usd?: number;
}

export interface BalanceCheckResult {
  /** What Fafnir had recorded on that day, in cents. */
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

/** end = start + moneyIn - moneyOut + added + rates, all in US cents. */
export interface WorthChange {
  /** What the user was worth as the month began, at that day's rate. */
  start: number;
  /** What the user was worth as it ended (or today), at that day's rate. */
  end: number;
  /** Starting balances and balance checks. */
  added: number;
  /** What's left: reais worth more or fewer dollars, and what exchanging cost. */
  rates: number;
}

export interface Book {
  accounts: MoneyAccount[];
  categories: Account[];
  /** The latest rate known; null if none has ever been fetched. */
  rate: Rate | null;
  /** All in US cents at the latest rate. */
  have: number;
  owe: number;
  /** Whether a BRL balance is left out of those because no rate is known. */
  missingRate: boolean;
  month: MonthSummary;
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
