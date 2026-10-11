// Whether a bullet matches a parsed query. Searches run on every keystroke over the whole tree,
// so what is derived from a node's text is computed once per node object (nodes are immutable:
// an edit makes a new object).
import type { Node } from "../../shared/protocol.ts";
import { nextDay } from "../text/dates.ts";
import { tokenize, type Token } from "../text/inline.ts";
import { normalize, type Term } from "./query.ts";

interface Derived {
  /** content and note, normalized */
  text: string;
  tags: string[];
  mentions: string[];
  dates: string[];
}

const cache = new WeakMap<Node, Derived>();

function collect(tokens: Token[], out: Derived): void {
  for (const t of tokens) {
    if (t.type === "tag") out.tags.push(t.name.toLowerCase());
    else if (t.type === "mention") out.mentions.push(t.name.toLowerCase());
    else if (t.type === "date") out.dates.push(t.date);
    else if (t.type === "bold" || t.type === "italic" || t.type === "strike") collect(t.children, out);
  }
}

/** The tags, mentions and dates in a node's text and note. */
export function derived(node: Node): Derived {
  let d = cache.get(node);
  if (!d) {
    d = { text: normalize(`${node.content}\n${node.note}`), tags: [], mentions: [], dates: [] };
    collect(tokenize(node.content), d);
    if (node.note) collect(tokenize(node.note), d);
    cache.set(node, d);
  }
  return d;
}

/** A tag matches itself and its sub-tags: #work finds #work/q4. */
const tagMatches = (have: string[], want: string) => have.some((t) => t === want || t.startsWith(`${want}/`));

function test(node: Node, t: Term, today: string): boolean {
  const d = derived(node);
  switch (t.kind) {
    case "word":
    case "phrase":
      return d.text.includes(t.value);
    case "tag":
      return tagMatches(d.tags, t.value);
    case "mention":
      return tagMatches(d.mentions, t.value);
    case "is":
      return node.completedAt !== null;
    case "has":
      return t.value === "note" ? node.note !== "" : d.dates.length > 0;
    case "date":
      if (t.value === "today") return d.dates.includes(today);
      if (t.value === "tomorrow") return d.dates.includes(nextDay(today));
      return node.completedAt === null && d.dates.some((date) => date < today);
    case "before":
      return d.dates.some((date) => date < t.value);
    case "after":
      return d.dates.some((date) => date > t.value);
  }
}

/** Whether every term matches (or, for a negated one, doesn't). */
export function matches(node: Node, terms: readonly Term[], today: string): boolean {
  return terms.every((t) => test(node, t, today) !== t.negate);
}
