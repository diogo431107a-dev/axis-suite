// Dates and times as the page shows them, in the browser's language. Days are formatted as UTC
// dates so the browser's time zone can't move them by a day.
import { dateParts, daysBetween } from "../shared/dates.ts";

const WITH_YEAR = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const NO_YEAR = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", timeZone: "UTC" });
const DATE_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

const utc = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day));

/** "13 October 1986", or "13 October" for --10-13. */
export function rememberedDate(date: string): string {
  const { year, month, day } = dateParts(date);
  return year === null ? NO_YEAR.format(utc(2000, month, day)) : WITH_YEAR.format(utc(year, month, day));
}

/** "October 2026", for a YYYY-MM-DD in that month. */
export const monthName = (date: string) => MONTH.format(utc(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 1));

/** "Tue 13", for a YYYY-MM-DD. */
export const dayOfMonth = (date: string) =>
  WEEKDAY.format(utc(Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))));

/** "Today", "Tomorrow", "in 5 days". */
export function whenFrom(date: string, today: string): string {
  const days = daysBetween(today, date);
  return days === 0 ? "Today" : days === 1 ? "Tomorrow" : `in ${days} days`;
}

/** A time from the server, with its date. */
export const savedAt = (iso: string) => DATE_TIME.format(new Date(iso));

/** "1 contact", "3 contacts" */
export const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
