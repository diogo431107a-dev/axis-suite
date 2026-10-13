// Days as YYYY-MM-DD, months as YYYY-MM, and ISO 8601 weeks: Monday is the first day, and week 1
// is the one with the year's first Thursday. Arithmetic runs in UTC, so it gives the same answer
// in any time zone; which day it is *now* depends on a time zone (see zones.ts).

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH = /^(\d{4})-(\d{2})$/;

export const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** The date of a UTC Date, as YYYY-MM-DD. */
export const dateOfUtc = (d: Date) =>
  `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Midnight UTC of a YYYY-MM-DD date. */
export function utcMidnight(date: string): Date {
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
  return dateOfUtc(utcMidnight(value)) === value;
}

/** Whether a value is a month as YYYY-MM. */
export function isMonth(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_MONTH.exec(value);
  return !!m && Number(m[1]) >= 1000 && Number(m[2]) >= 1 && Number(m[2]) <= 12;
}

export const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

export function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}

/** The date n days after (or before, for negative n) a date. */
export function addDays(date: string, n: number): string {
  const d = utcMidnight(date);
  d.setUTCDate(d.getUTCDate() + n);
  return dateOfUtc(d);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((utcMidnight(b).getTime() - utcMidnight(a).getTime()) / 86_400_000);
}

/** The same day n years later; 29 February becomes the 28th in other years. */
export function addYears(date: string, n: number): string {
  const year = Number(date.slice(0, 4)) + n;
  const month = Number(date.slice(5, 7));
  const day = Math.min(Number(date.slice(8, 10)), daysInMonth(year, month));
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** The day of the week: Monday 0 … Sunday 6. */
export const weekdayIndex = (date: string) => (utcMidnight(date).getUTCDay() + 6) % 7;

/** "Mon" … "Sun". */
export const weekdayName = (date: string) => WEEKDAYS[weekdayIndex(date)]!;

/** The Monday of a date's week. */
export const weekStart = (date: string) => addDays(date, -weekdayIndex(date));

/** A date's ISO week: its week-year (which may differ from the date's year near New Year) and number. */
export function isoWeek(date: string): { year: number; week: number } {
  // The week belongs to the year its Thursday is in.
  const thursday = addDays(date, 3 - weekdayIndex(date));
  const year = Number(thursday.slice(0, 4));
  return { year, week: Math.floor(daysBetween(`${pad(year, 4)}-01-01`, thursday) / 7) + 1 };
}

/** "2026-W42". */
export function weekLabel(date: string): string {
  const { year, week } = isoWeek(date);
  return `${pad(year, 4)}-W${pad(week)}`;
}

/** The month a date is in, YYYY-MM. */
export const monthOf = (date: string) => date.slice(0, 7);

/** The month n months after (or before) a YYYY-MM month. */
export function addMonths(month: string, n: number): string {
  const total = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  return `${pad(Math.floor(total / 12), 4)}-${pad((total % 12) + 1)}`;
}

/**
 * The weeks a month view shows: each a list of 7 dates, Monday first, from the week of the 1st to
 * the week of the last day (4 to 6 weeks).
 */
export function monthWeeks(month: string): string[][] {
  const first = `${month}-01`;
  const last = `${month}-${pad(daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7))))}`;
  const weeks: string[][] = [];
  for (let monday = weekStart(first); monday <= last; monday = addDays(monday, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(monday, i)));
  }
  return weeks;
}
