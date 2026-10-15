// Days as YYYY-MM-DD, and ISO 8601 weeks: Monday is the first day. Arithmetic runs in UTC, so it
// gives the same answer in any time zone; which day it is *now* depends on a time zone (see
// zones.ts). Taken from Chronos's shared/dates.ts, keeping what Urd uses.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

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

/** The date n days after (or before, for negative n) a date. */
export function addDays(date: string, n: number): string {
  const d = utcMidnight(date);
  d.setUTCDate(d.getUTCDate() + n);
  return dateOfUtc(d);
}

/** The day of the week: Monday 0 … Sunday 6. */
export const weekdayIndex = (date: string) => (utcMidnight(date).getUTCDay() + 6) % 7;

/** The Monday of a date's week. */
export const weekStart = (date: string) => addDays(date, -weekdayIndex(date));

/** The month a date is in, YYYY-MM. */
export const monthOf = (date: string) => date.slice(0, 7);

/** Today's date on this computer's clock (the browser's time zone). */
export function today(now = new Date()): string {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
