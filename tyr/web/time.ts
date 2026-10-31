// Reading and showing dates and times: ISO and 24h, fixed by design.
import type { Precision, Stamp } from "../shared/protocol.ts";
import { isDate } from "../shared/time.ts";

const pad = (n: number) => String(n).padStart(2, "0");

/** A moment's calendar day here, in the browser: the VPS's clock isn't the user's. */
export function isoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function clock(d: Date = new Date()): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const nowText = (): string => `${isoDate()} ${clock()}`;

/** An instant as it reads here: logged-at. */
export function localInstant(iso: string): string {
  const d = new Date(iso);
  return `${isoDate(d)} ${clock(d)}`;
}

function parseIso(text: string): Date {
  const [y = 1970, m = 1, d = 1] = text.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseIso(to).getTime() - parseIso(from).getTime()) / 86_400_000);
}

export function addDays(date: string, n: number): string {
  const d = parseIso(date);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

export function toMinutes(time: string): number {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return h * 60 + m;
}

export const fromMinutes = (minutes: number): string => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

export function showStamp(s: Stamp): string {
  if (s.p === "around") return `c. ${s.d}`;
  if (!s.t) return s.d;
  return /\d/.test(s.t) ? `${s.d} ${s.t}` : `${s.d} · ${s.t}`;
}

export const PRECISION_LABEL: Record<Precision, string> = {
  date: "Exact date",
  month: "Month only",
  year: "Year only",
  around: "Around a year",
};

export interface ParsedDate {
  d: string;
  p: Precision;
}

/** What the user typed in a date field: today, yesterday, -3, 2026-10-31, 2026-10, 2009, ~2009. */
export function parseDateText(raw: string, today: string): ParsedDate | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  if (text === "today" || text === "now") return { d: today, p: "date" };
  if (text === "yesterday") return { d: addDays(today, -1), p: "date" };
  let m = /^-(\d{1,4})$/.exec(text);
  if (m) return { d: addDays(today, -Number(m[1])), p: "date" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return isDate(text) ? { d: text, p: "date" } : null;
  m = /^\d{4}-(\d{2})$/.exec(text);
  if (m) return Number(m[1]) >= 1 && Number(m[1]) <= 12 ? { d: text, p: "month" } : null;
  if (/^\d{4}$/.test(text)) return { d: text, p: "year" };
  m = /^(?:~|c\.?\s*|around\s+)(\d{4})$/.exec(text);
  return m ? { d: m[1]!, p: "around" } : null;
}

export const showParsed = (r: ParsedDate): string => (r.p === "around" ? `~${r.d}` : r.d);

/** A date field's text after its precision is changed in the list. */
export function withPrecision(raw: string, p: Precision, today: string): string {
  const r = parseDateText(raw, today) ?? { d: today, p: "date" };
  const full = r.d.length === 4 ? `${r.d}-01-01` : r.d.length === 7 ? `${r.d}-01` : r.d;
  if (p === "date") return full;
  if (p === "month") return full.slice(0, 7);
  return p === "year" ? full.slice(0, 4) : `~${full.slice(0, 4)}`;
}

/** A full date from a date field, or null. */
export function fullDate(raw: string, today: string): string | null {
  const parsed = parseDateText(raw, today);
  return parsed?.p === "date" ? parsed.d : null;
}
