// Money and dates, as the page shows and reads them. Amounts are whole numbers of a currency's
// smallest unit everywhere.
import { CURRENCY_INFO, amountDigits, isCoin, unitOf } from "../shared/currencies.ts";
import type { Currency, IsoDate, MoneyKind } from "../shared/protocol.ts";

/** Whether an account's balance below zero is what the user owes on it, rather than an overdraft. */
export const holdsDebt = (account: { kind: MoneyKind }) => account.kind === "card" || account.kind === "borrowed";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function plainAmount(amount: number, currency: Currency = "USD"): string {
  return amountDigits(amount, currency, true);
}

/** What goes in front of an amount typed in a field. */
export const symbolOf = (currency: Currency | undefined): string =>
  currency === undefined || currency === "USD" ? "$" : currency === "BRL" ? "R$" : currency;

export function money(amount: number, currency: Currency = "USD"): string {
  const sign = amount < 0 ? "−" : "";
  if (isCoin(currency)) return `${sign}${plainAmount(amount, currency)} ${currency}`;
  const symbol = currency === "BRL" ? "R$ " : "$";
  return `${sign}${symbol}${plainAmount(amount, currency)}`;
}

/**
 * What the user typed, in the currency's smallest unit; null if it can't be read. Takes both 1,234.56
 * and 1.234,56, since bank apps in Brazil show the second.
 *
 * Whether a lone separator is the decimal point depends on the currency. In reais or dollars it is
 * if one or two digits follow it, so 1.234 is a thousand and more. In a coin it always is, so 1.234
 * BTC stays a little over one: there, a slip of a thousand times would cost real money.
 */
export function parseAmount(text: string, currency: Currency = "USD"): number | null {
  const cleaned = text.replace(/\s|R\$|\$|BTC|ICP|USDC/gi, "");
  const negative = /^[-−]/.test(cleaned);
  const digits = cleaned.replace(/^[-−]/, "");
  if (!/^\d[\d.,]*$/.test(digits)) return null;

  const { decimals } = CURRENCY_INFO[currency];
  const separators = digits.replace(/\d/g, "");
  const lastSep = Math.max(digits.lastIndexOf("."), digits.lastIndexOf(","));
  const after = lastSep === -1 ? "" : digits.slice(lastSep + 1);
  const mixed = separators.includes(".") && separators.includes(",");
  // Several of one kind (1.234.567) can only be thousands, whatever the currency.
  const hasDecimals =
    lastSep !== -1 && (mixed || (isCoin(currency) ? separators.length === 1 : after.length <= decimals));
  if (hasDecimals && (after.length === 0 || after.length > decimals)) return null;
  const whole = hasDecimals ? digits.slice(0, lastSep) : digits;
  if (!/^\d+$/.test(whole) && !/^\d{1,3}([.,]\d{3})+$/.test(whole)) return null;

  const fraction = hasDecimals ? Number(after.padEnd(decimals, "0")) : 0;
  const amount = Number(whole.replace(/[.,]/g, "")) * unitOf(currency) + fraction;
  if (!Number.isSafeInteger(amount)) return null;
  return negative ? -amount : amount;
}

/** The user's calendar day, not the UTC one. */
export function localDate(date: Date = new Date()): IsoDate {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function showDate(date: IsoDate): string {
  return `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}, ${date.slice(0, 4)}`;
}

export function showMonth(month: string): string {
  return `${LONG_MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

export function addMonths(month: string, count: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export const KIND_NAMES: Record<MoneyKind, string> = {
  cash: "Cash",
  bank: "Bank account",
  savings: "Savings",
  card: "Credit card",
  crypto: "Crypto",
  borrowed: "Money I borrowed",
  lent: "Money I lent",
};
