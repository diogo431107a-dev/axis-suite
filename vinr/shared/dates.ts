// Days as YYYY-MM-DD, and birthdays and other dates to remember, which may lack the year:
// --MM-DD (as vCard writes them). Which day it is today is the browser's business (its time
// zone). Arithmetic runs in UTC, so it gives the same answer in any time zone.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NO_YEAR = /^--(\d{2})-(\d{2})$/;

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

export const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

export function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}

/** A date to remember: YYYY-MM-DD, or --MM-DD without the year (--02-29 is one). */
export function isPartialDate(value: unknown): value is string {
  if (isDate(value)) return true;
  if (typeof value !== "string") return false;
  const m = NO_YEAR.exec(value);
  if (!m) return false;
  const month = Number(m[1]);
  const day = Number(m[2]);
  // A year that has a 29 February, so --02-29 counts.
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(2000, month);
}

/** The parts of a date to remember; year is null without one. */
export function dateParts(date: string): { year: number | null; month: number; day: number } {
  if (date.startsWith("--")) return { year: null, month: Number(date.slice(2, 4)), day: Number(date.slice(5, 7)) };
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)) };
}

/** Builds a date to remember from its parts (year null: --MM-DD). */
export const partialDate = (year: number | null, month: number, day: number) =>
  year === null ? `--${pad(month)}-${pad(day)}` : `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

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

/** The day a date to remember falls on in a year: 29 February is kept on the 28th in other years. */
export function inYear(date: string, year: number): string {
  const { month, day } = dateParts(date);
  return partialDate(year, month, Math.min(day, daysInMonth(year, month)));
}

/** The next time a date comes round, today included. */
export function nextOccurrence(date: string, today: string): string {
  const year = Number(today.slice(0, 4));
  const thisYear = inYear(date, year);
  return thisYear >= today ? thisYear : inYear(date, year + 1);
}

/**
 * How many years old someone born on `birthday` is on `on`, or null when the year isn't known or
 * `on` is before the birthday itself.
 */
export function ageOn(birthday: string, on: string): number | null {
  const { year } = dateParts(birthday);
  if (year === null) return null;
  const onYear = Number(on.slice(0, 4));
  let age = onYear - year;
  if (inYear(birthday, onYear) > on) age--;
  return age < 0 ? null : age;
}
