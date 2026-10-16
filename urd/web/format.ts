// Times and dates as the page shows them. Whole seconds only.
import { pad, today, utcMidnight } from "../shared/dates.ts";

/** A running clock: 5415 → "1:30:15"; hours go past 24 ("312:05:41"). */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

/** A total: 5415 → "1h 30m", 7200 → "2h", 900 → "15m", 30 → "0m". */
export function hours(seconds: number): string {
  const m = Math.floor(Math.max(0, seconds) / 60);
  const h = Math.floor(m / 60);
  if (h === 0) return `${m}m`;
  return m % 60 ? `${h}h ${pad(m % 60)}m` : `${h}h`;
}

const DAY_TITLE = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const DAY_SHORT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const TIME = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** "Thu, 15 Oct 2026" for a YYYY-MM-DD day. */
export const dayTitle = (day: string) => DAY_TITLE.format(utcMidnight(day));

/** "Thu, 15 Oct" for a YYYY-MM-DD day. */
export const dayShort = (day: string) => DAY_SHORT.format(utcMidnight(day));

/** "09:12": an instant on this computer's clock. */
export const timeOfDay = (instant: string) => TIME.format(Date.parse(instant));

/** "2026-10-15": an instant's date on this computer's clock. */
export const localDay = (instant: string) => today(new Date(Date.parse(instant)));

/** "15 Oct 2026": an instant's date on this computer's clock. */
export const dateOf = (instant: string) => DATE.format(Date.parse(instant));

/** An instant as a datetime-local field's value, on this computer's clock: "2026-10-15T09:12:03". */
export function localInput(instant: string): string {
  const d = new Date(Date.parse(instant));
  return (
    `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** A datetime-local field's value (seconds optional) → milliseconds since 1970, or null if it isn't one. */
export function fromLocalInput(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/** "1 session", "3 sessions". */
export const sessionsText = (n: number) => `${n.toLocaleString()} session${n === 1 ? "" : "s"}`;
