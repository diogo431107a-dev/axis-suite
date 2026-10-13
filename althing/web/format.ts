// Dates and times the suite's way (ISO, 24 hours, no localization), and links in messages.

const pad = (n: number) => String(n).padStart(2, "0");

/** This device's date of an ISO time, YYYY-MM-DD. */
export function dayOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** This device's time of an ISO time, HH:MM. */
export function timeOf(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type Piece = { text: string; href?: undefined } | { text: string; href: string };

// http(s) addresses, without a final punctuation mark (the end of a sentence).
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]'*_]/g;

/** Splits a message into plain text and links. */
export function linkify(text: string): Piece[] {
  const pieces: Piece[] = [];
  let at = 0;
  for (const m of text.matchAll(URL_PATTERN)) {
    if (m.index > at) pieces.push({ text: text.slice(at, m.index) });
    pieces.push({ text: m[0], href: m[0] });
    at = m.index + m[0].length;
  }
  if (at < text.length) pieces.push({ text: text.slice(at) });
  return pieces;
}

/** A badge's number: at most "99+". */
export function badge(n: number): string {
  return n > 99 ? "99+" : String(n);
}
