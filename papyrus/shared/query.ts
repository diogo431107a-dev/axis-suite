// The search box's language (from Yggdrasil's). Terms are separated by spaces and must all
// match; a leading "-" turns one around.
//   words             in the text, ignoring case and accents
//   "exact phrase"
//   #tag              also finds its sub-tags: #work finds #work/meetings
//   mood:4  mood:>=4  mood:<3 …
//   before:YYYY-MM-DD  after:YYYY-MM-DD   (the day of the page, not counting that day)
import { isDate } from "./dates.ts";
import { tagKey } from "./tags.ts";
import { normalize } from "./words.ts";

export type MoodOp = "=" | "<" | "<=" | ">" | ">=";

export type Term = { negate: boolean } & (
  | { kind: "word" | "phrase"; value: string }
  | { kind: "tag"; value: string }
  | { kind: "mood"; op: MoodOp; value: number }
  | { kind: "before" | "after"; value: string }
);

const MOOD = /^(<=|>=|<|>|=)?([1-5])$/;

function term(raw: string, negate: boolean, quoted: boolean): Term | null {
  if (quoted) {
    const value = normalize(raw.trim());
    return value ? { kind: "phrase", value, negate } : null;
  }
  if (raw.length > 1 && raw[0] === "#") return { kind: "tag", value: tagKey(raw.slice(1)), negate };
  const colon = raw.indexOf(":");
  if (colon > 0) {
    const key = raw.slice(0, colon).toLowerCase();
    const value = raw.slice(colon + 1);
    const mood = key === "mood" ? MOOD.exec(value) : null;
    if (mood) return { kind: "mood", op: (mood[1] ?? "=") as MoodOp, value: Number(mood[2]), negate };
    if ((key === "before" || key === "after") && isDate(value)) return { kind: key, value, negate };
  }
  const value = normalize(raw);
  return value ? { kind: "word", value, negate } : null;
}

export function parseQuery(query: string): Term[] {
  const terms: Term[] = [];
  // -?"a phrase" or -?word
  for (const m of query.matchAll(/(-?)(?:"([^"]*)"?|(\S+))/g)) {
    const quoted = m[2] !== undefined;
    const t = term(quoted ? m[2]! : m[3]!, m[1] === "-", quoted);
    if (t) terms.push(t);
  }
  return terms;
}
