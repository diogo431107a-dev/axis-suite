// The search box's language. Terms are separated by spaces and must all match; a leading "-"
// turns one around.
//   words             in the text or note, ignoring case and accents
//   "exact phrase"
//   #tag  @who
//   is:completed      has:note  has:date
//   date:today  date:tomorrow  date:overdue  before:YYYY-MM-DD  after:YYYY-MM-DD

export type Term = { negate: boolean } & (
  | { kind: "word" | "phrase"; value: string }
  | { kind: "tag" | "mention"; value: string }
  | { kind: "is"; value: "completed" }
  | { kind: "has"; value: "note" | "date" }
  | { kind: "date"; value: "today" | "tomorrow" | "overdue" }
  | { kind: "before" | "after"; value: string }
);

/** Lowercase, without accents: "Été" and "ete" are the same word. */
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function term(raw: string, negate: boolean, quoted: boolean): Term | null {
  if (!raw) return null;
  if (quoted) return { kind: "phrase", value: normalize(raw), negate };
  if (raw.length > 1 && (raw[0] === "#" || raw[0] === "@")) {
    return { kind: raw[0] === "#" ? "tag" : "mention", value: raw.slice(1).toLowerCase(), negate };
  }
  const colon = raw.indexOf(":");
  if (colon > 0) {
    const key = raw.slice(0, colon).toLowerCase();
    const value = raw.slice(colon + 1).toLowerCase();
    if (key === "is" && value === "completed") return { kind: "is", value, negate };
    if (key === "has" && (value === "note" || value === "date")) return { kind: "has", value, negate };
    if (key === "date" && (value === "today" || value === "tomorrow" || value === "overdue")) {
      return { kind: "date", value, negate };
    }
    if ((key === "before" || key === "after") && ISO_DATE.test(value)) return { kind: key, value, negate };
  }
  return { kind: "word", value: normalize(raw), negate };
}

export function parseQuery(query: string): Term[] {
  const terms: Term[] = [];
  // -?"a phrase" or -?word
  for (const m of query.matchAll(/(-?)(?:"([^"]*)"?|(\S+))/g)) {
    const negate = m[1] === "-";
    const quoted = m[2] !== undefined;
    const t = term(quoted ? m[2]!.trim() : m[3]!, negate, quoted);
    if (t) terms.push(t);
  }
  return terms;
}

/** Whether the query asks about completed bullets, so they are searched even while hidden. */
export const mentionsCompleted = (terms: readonly Term[]) => terms.some((t) => t.kind === "is");
