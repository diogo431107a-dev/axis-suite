// Runs a search over the tree inside the zoomed-in bullet: the bullets that match, and the
// ones to show (the matches and their ancestors).
import type { Store } from "../model/store.ts";
import { derived, matches } from "./match.ts";
import { mentionsCompleted, type Term } from "./query.ts";

export interface SearchResult {
  filter: Set<string>;
  matches: Set<string>;
}

/**
 * `keep` stays shown even if it doesn't match: the bullet being edited, which would otherwise
 * vanish under the caret (a new bullet made with Enter in a result, say).
 */
export function runSearch(
  store: Store,
  root: string | null,
  terms: readonly Term[],
  showCompleted: boolean,
  today: string,
  keep: string | null,
): SearchResult {
  const filter = new Set<string>();
  const matched = new Set<string>();
  // Completed bullets (and what is under them) are searched only when shown, or asked for.
  const withCompleted = showCompleted || mentionsCompleted(terms);
  const walk = (parentId: string | null): boolean => {
    let any = false;
    for (const id of store.children(parentId)) {
      const node = store.get(id)!;
      if (node.deletedAt !== null || (!withCompleted && node.completedAt !== null)) continue;
      const hit = matches(node, terms, today);
      if (hit) matched.add(id);
      if (walk(id) || hit || id === keep) {
        filter.add(id);
        any = true;
      }
    }
    return any;
  };
  walk(root);
  return { filter, matches: matched };
}

/**
 * The tags inside root (not on root itself) and how many bullets carry each, most used first.
 * It looks at the bullets a search does, so the list matches what clicking a tag finds.
 */
export function tagCounts(store: Store, root: string | null, showCompleted: boolean): [string, number][] {
  const counts = new Map<string, number>();
  const walk = (parentId: string | null) => {
    for (const id of store.children(parentId)) {
      const node = store.get(id)!;
      if (node.deletedAt !== null || (!showCompleted && node.completedAt !== null)) continue;
      for (const tag of new Set(derived(node).tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      walk(id);
    }
  };
  walk(root);
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

export function sameSet(a: ReadonlySet<string> | null, b: ReadonlySet<string> | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/** A pattern for the query's words and phrases, to highlight them. null if there are none. */
export function highlightPattern(terms: readonly Term[]): RegExp | null {
  const words = terms
    .filter((t) => !t.negate && (t.kind === "word" || t.kind === "phrase"))
    .map((t) => t.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length);
  return words.length > 0 ? new RegExp(`(${words.join("|")})`, "gi") : null;
}
