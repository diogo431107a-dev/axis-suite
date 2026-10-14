// Ranks: where an item sits among its siblings, as fractional-indexing keys compared as text.
// A move names the sibling it goes after; the new rank is made between that one and the next.
// Two tabs placing items at the same spot at the same time can leave two siblings with the same
// rank (the id then orders them), and no key fits between equal ranks: the caller then gives the
// siblings fresh, evenly spread ranks and asks again.
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

export interface Ranked {
  id: string;
  rank: string;
}

/**
 * The rank for an item placed after `afterId` (null: first) among `siblings`, which are in order
 * and leave out the item being placed. Null if no key fits between the neighbours (equal ranks).
 * Throws if `afterId` isn't one of them.
 */
export function rankAfter(siblings: readonly Ranked[], afterId: string | null): string | null {
  const at = afterId === null ? -1 : siblings.findIndex((s) => s.id === afterId);
  if (afterId !== null && at < 0) throw new RangeError(`${afterId} is not a sibling`);
  const lo = at >= 0 ? siblings[at]!.rank : null;
  const hi = siblings[at + 1]?.rank ?? null;
  if (lo !== null && hi !== null && lo >= hi) return null;
  return generateKeyBetween(lo, hi);
}

/** The rank for an item placed last. */
export const rankAtEnd = (siblings: readonly Ranked[]) => generateKeyBetween(siblings.at(-1)?.rank ?? null, null);

/** n fresh ranks in order, evenly spread: for re-ranking siblings, or adding many at once. */
export const freshRanks = (n: number) => generateNKeysBetween(null, null, n);
