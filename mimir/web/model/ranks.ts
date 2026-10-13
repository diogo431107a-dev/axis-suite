// Ranks for new positions among siblings. Two tabs inserting at the same spot at the same time
// can give two siblings the same rank (the id then decides their order); a key can't be made
// between equal ranks, so the next larger one is used instead.
import { generateNKeysBetween } from "fractional-indexing";
import type { MapNode } from "../../shared/protocol.ts";

interface Siblings {
  get(id: string): MapNode | undefined;
  children(parentId: string): readonly string[];
}

/** The siblings' ranks in order, leaving out the nodes being placed. */
function ranksOf(tree: Siblings, parentId: string, exclude: ReadonlySet<string>) {
  return tree
    .children(parentId)
    .filter((id) => !exclude.has(id))
    .map((id) => ({ id, rank: tree.get(id)!.rank }));
}

/** n ranks, in order, for nodes placed right after `afterId` (null: first) under `parentId`. */
export function ranksAfter(
  tree: Siblings,
  parentId: string,
  afterId: string | null,
  n: number,
  exclude: ReadonlySet<string> = new Set(),
): string[] {
  const list = ranksOf(tree, parentId, exclude);
  const at = afterId === null ? -1 : list.findIndex((s) => s.id === afterId);
  const lo = at >= 0 ? list[at]!.rank : null;
  const hi = list.slice(at + 1).find((s) => lo === null || s.rank > lo)?.rank ?? null;
  return generateNKeysBetween(lo, hi, n);
}

/** n ranks, in order, for nodes placed right before `beforeId` under `parentId`. */
export function ranksBefore(
  tree: Siblings,
  parentId: string,
  beforeId: string,
  n: number,
  exclude: ReadonlySet<string> = new Set(),
): string[] {
  const list = ranksOf(tree, parentId, exclude);
  const at = list.findIndex((s) => s.id === beforeId);
  if (at < 0) return ranksAfter(tree, parentId, null, n, exclude);
  const hi = list[at]!.rank;
  const lo = list.slice(0, at).findLast((s) => s.rank < hi)?.rank ?? null;
  return generateNKeysBetween(lo, hi, n);
}

/** n ranks, in order, after every existing child. */
export function ranksAtEnd(
  tree: Siblings,
  parentId: string,
  n: number,
  exclude: ReadonlySet<string> = new Set(),
): string[] {
  const list = ranksOf(tree, parentId, exclude);
  return generateNKeysBetween(list.at(-1)?.rank ?? null, null, n);
}
