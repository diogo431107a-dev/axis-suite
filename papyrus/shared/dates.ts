// Days as YYYY-MM-DD. Which day it is today is the browser's business (its time zone); the server
// is always told. Arithmetic runs in UTC, so it gives the same answer on the server and in any
// time zone, daylight saving included.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** The date of a UTC Date, as YYYY-MM-DD. */
const fromUtc = (d: Date) => `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Midnight UTC of a YYYY-MM-DD date. */
export function toUtc(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d!));
  // Date.UTC reads years 0–99 as 1900–1999.
  utc.setUTCFullYear(y!);
  return utc;
}

/** Whether a value is a real day as YYYY-MM-DD, in the years 1000 to 9999 ("2026-02-30" isn't). */
export function isDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_DATE.exec(value);
  if (!m || Number(m[1]) < 1000) return false;
  return fromUtc(toUtc(value)) === value;
}

/** Today in the browser's time zone. */
export function today(now = new Date()): string {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The date n days after (or before, for negative n) a date. */
export function addDays(date: string, n: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
export const weekday = (date: string) => toUtc(date).getUTCDay();

export const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

export function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}

/** The first day of a date's month. */
export const monthStart = (date: string) => `${date.slice(0, 8)}01`;

/** The first day of the month n months after (or before) a date's month. */
export function addMonths(date: string, n: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1 + n;
  const year = y + Math.floor(m / 12);
  return `${pad(year, 4)}-${pad((((m % 12) + 12) % 12) + 1)}-01`;
}

/**
 * The month-days ("MM-DD") whose earlier pages "On this day" shows for a date. On Feb 28 of a year
 * without a Feb 29, the Feb 29 pages of leap years are shown too; on Feb 29, only those.
 */
export function anniversaryDays(date: string): string[] {
  const md = date.slice(5);
  return md === "02-28" && !isLeapYear(Number(date.slice(0, 4))) ? ["02-28", "02-29"] : [md];
}
