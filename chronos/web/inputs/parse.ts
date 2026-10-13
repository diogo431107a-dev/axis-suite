// What people type into the date and time fields, read leniently and written back the ISO way.
import { isDate, pad } from "../../shared/dates.ts";

/** "2026-10-13", "20261013" or "2026-1-3" → "2026-10-13"; null if it isn't a date. */
export function parseDateInput(text: string): string | null {
  const m = /^(\d{4})-?(\d{1,2})-?(\d{1,2})$/.exec(text.trim());
  if (!m) return null;
  const date = `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
  return isDate(date) ? date : null;
}

/** "14:00", "1400", "14", "9:5" → "HH:MM"; null if it isn't a time. */
export function parseTimeInput(text: string): string | null {
  const t = text.trim();
  const m = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(t) ?? /^(\d{1,2})(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}
