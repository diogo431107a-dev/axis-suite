// Dates and times as the page shows them, in the browser's language. Days are YYYY-MM-DD; they
// are formatted as UTC dates so the browser's time zone can't move them by a day.
import { addDays, daysBetween, toUtc } from "../shared/dates.ts";

const LONG = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const MEDIUM = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: "long", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
const MONTH_SHORT = new Intl.DateTimeFormat(undefined, { month: "short", timeZone: "UTC" });
const WEEKDAY_SHORT = new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" });
const TIME = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const DATE_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** "Monday, 12 October 2026" */
export const longDate = (date: string) => LONG.format(toUtc(date));
/** "12 Oct 2026" */
export const mediumDate = (date: string) => MEDIUM.format(toUtc(date));
/** "Monday" */
export const weekdayName = (date: string) => WEEKDAY.format(toUtc(date));
/** "October 2026", for a YYYY-MM-DD in that month */
export const monthName = (date: string) => MONTH.format(toUtc(date));
/** "Oct" for a month 1–12 */
export const shortMonth = (month: number) => MONTH_SHORT.format(new Date(Date.UTC(2026, month - 1, 1)));

/** The names of the week's days, starting on weekStart (0 = Sunday). */
export function weekdayNames(weekStart: number): string[] {
  // 2026-10-11 is a Sunday.
  return Array.from({ length: 7 }, (_, i) => WEEKDAY_SHORT.format(toUtc(addDays("2026-10-11", weekStart + i))));
}

/** "Today", "Yesterday" or "Tomorrow", else null. */
export function nearDay(date: string, today: string): string | null {
  const days = daysBetween(today, date);
  return days === 0 ? "Today" : days === -1 ? "Yesterday" : days === 1 ? "Tomorrow" : null;
}

/** "1 year ago", "3 years ago" */
export function yearsAgo(date: string, today: string): string {
  const years = Number(today.slice(0, 4)) - Number(date.slice(0, 4));
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

/** A time from the server: "14:32" today, else with its date. */
export function savedAt(iso: string): string {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? TIME.format(d) : DATE_TIME.format(d);
}
