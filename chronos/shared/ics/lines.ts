// iCalendar's (RFC 5545) content lines: NAME;PARAM=value;…:value, folded at 75 octets.

export interface Prop {
  name: string;
  /** parameter names in upper case; values without their quotes */
  params: Map<string, string[]>;
  /** as written: escapes are left for the reader of each property */
  value: string;
}

/** The file's lines, folded lines joined. */
export function logicalLines(text: string): string[] {
  const lines: string[] = [];
  for (const line of text.replace(/^﻿/, "").split(/\r\n|\r|\n/)) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) lines[lines.length - 1] += line.slice(1);
    else if (line.trim() !== "") lines.push(line);
  }
  return lines;
}

/** One content line, or null if it has no colon. */
export function parseLine(line: string): Prop | null {
  // The value starts after the first colon outside double quotes.
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon === -1) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = splitOutsideQuotes(head, ";");
  const name = parts[0]!.trim().toUpperCase();
  const params = new Map<string, string[]>();
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq === -1) continue;
    const key = p.slice(0, eq).trim().toUpperCase();
    const values = splitOutsideQuotes(p.slice(eq + 1), ",").map((v) => v.trim().replace(/^"|"$/g, ""));
    params.set(key, [...(params.get(key) ?? []), ...values]);
  }
  return { name, params, value };
}

function splitOutsideQuotes(s: string, sep: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    if (ch === sep && !quoted) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  return parts;
}

/** A TEXT value: \n, \, \; and \\ undone. */
export const unescapeText = (s: string) =>
  s.replace(/\\([nN,;:\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));

export const escapeText = (s: string) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/([,;])/g, "\\$1");

/** Folds a line to at most 75 bytes, never inside a character; continuations start with a space. */
export function fold(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    // The first line has 75 bytes; the others 74 after their leading space.
    if (bytes + n > (out.length === 0 ? 75 : 74)) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}
