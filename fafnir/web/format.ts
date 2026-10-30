// Money and dates, as the page shows and reads them. Amounts are whole cents everywhere.
import type { Currency, IsoDate, MoneyKind } from "../shared/protocol.ts";

const SYMBOL: Record<Currency, string> = { USD: "$", BRL: "R$ " };
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

export function plainAmount(cents: number): string {
  return (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function money(cents: number, currency: Currency = "USD"): string {
  return `${cents < 0 ? "−" : ""}${SYMBOL[currency]}${plainAmount(cents)}`;
}

/**
 * What the user typed, in cents; null if it can't be read. Takes both 1,234.56 and 1.234,56, since
 * bank apps in Brazil show the second: one or two digits after the last separator are the cents.
 */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/\s|R\$|\$/gi, "");
  const negative = /^[-−]/.test(cleaned);
  const digits = cleaned.replace(/^[-−]/, "");
  if (!/^\d[\d.,]*$/.test(digits)) return null;

  const lastSep = Math.max(digits.lastIndexOf("."), digits.lastIndexOf(","));
  const after = lastSep === -1 ? "" : digits.slice(lastSep + 1);
  const hasCents = lastSep !== -1 && after.length <= 2;
  if (hasCents && after.length === 0) return null;
  const whole = hasCents ? digits.slice(0, lastSep) : digits;
  if (!/^\d+$/.test(whole) && !/^\d{1,3}([.,]\d{3})+$/.test(whole)) return null;

  const cents = Number(whole.replace(/[.,]/g, "")) * 100 + (hasCents ? Number(after.padEnd(2, "0")) : 0);
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
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
};
