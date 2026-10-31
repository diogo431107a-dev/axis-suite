// Moments and names, as the server and the page both need them. Dates are ISO and times 24h, fixed
// by design. Nothing here looks at a clock: "today" is the browser's to say.
import { BANDS, type Stamp } from "./protocol.ts";

const BAND_TIME: Record<string, string> = { morning: "08:00", afternoon: "14:00", evening: "19:00", night: "22:00" };

/** For comparing names and labels: no accents, no case. Álvaro and alvaro are the same. */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
}

/** The drawer's letter for a name: A to Z, or # for anything else. */
export function letterOf(name: string): string {
  const first = fold(name.trim())[0] ?? "#";
  return /[A-Z]/.test(first) ? first : "#";
}

/** A day that exists, as YYYY-MM-DD. */
export function isDate(text: unknown): text is string {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function isClock(text: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text);
}

/** A day of the year, as MM-DD. 02-29 is allowed: other years it falls on 02-28. */
export function isMonthDay(text: unknown): text is string {
  return typeof text === "string" && /^\d{2}-\d{2}$/.test(text) && isDate(`2024-${text}`);
}

/** Whether a stamp is well made: its date has the shape of its precision, and only a day has a time. */
export function isStamp(value: unknown): value is Stamp {
  if (typeof value !== "object" || value === null) return false;
  const { d, t, p } = value as Partial<Stamp>;
  if (typeof d !== "string") return false;
  if (p === "date") {
    if (!isDate(d)) return false;
    return t === null || (typeof t === "string" && (isClock(t) || (BANDS as readonly string[]).includes(t)));
  }
  if (t !== null) return false;
  if (p === "month") return /^\d{4}-(0[1-9]|1[0-2])$/.test(d);
  return (p === "year" || p === "around") && /^\d{4}$/.test(d);
}

/** Sorts a stamp by the start of its range. */
export function stampKey(s: Stamp): string {
  const day = s.d.length === 4 ? `${s.d}-01-01` : s.d.length === 7 ? `${s.d}-01` : s.d;
  const time = s.t === null ? "00:00" : (BAND_TIME[s.t] ?? s.t);
  return `${day} ${time}`;
}

/** The end of a stamp's range: a whole year, month or day, unless the hour is exact. */
function stampEndKey(s: Stamp): string {
  if (s.d.length === 4) return `${s.d}-12-31 23:59`;
  if (s.d.length === 7) return `${s.d}-31 23:59`;
  return s.t !== null && isClock(s.t) ? `${s.d} ${s.t}` : `${s.d} 23:59`;
}

/** Whether something is said to have happened after it was told, even allowing for vague dates. */
export function happenedAfterTold(hap: Stamp, told: Stamp): boolean {
  return stampKey(hap) > stampEndKey(told);
}
