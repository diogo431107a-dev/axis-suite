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

export const MONEY_KINDS = ["cash", "bank", "savings", "card", "crypto", ...LOAN_KINDS] as const;
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

/** An amount in a currency other than the account's. */
export interface Foreign {
  currency: Currency;
  /** In the currency's smallest unit. */
  amount: number;
}

/** A fee taken out of a move or an exchange, recorded as spending. */
export interface Fee extends Foreign {
  /** What it was worth in US cents. */
  usd: number;
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
  /** Required on exchanged: what arrived, in the smallest unit of the `other` account's currency. */
  arrived?: number;
  /** On moved and exchanged: how much of `amount` went on a fee, in the same currency. */
  fee?: number;
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

/** end = start + moneyIn - moneyOut + added + rates, all in US cents. */
export interface WorthChange {
  /** What the user was worth as the month began, at that day's rate. */
  start: number;
  /** What the user was worth as it ended (or today), at that day's rate. */
  end: number;
  /** Starting balances and balance checks. */
  added: number;
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
