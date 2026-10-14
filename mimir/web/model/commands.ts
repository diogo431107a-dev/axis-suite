// What each editing action does to a map, as ops. Pure functions: they read the map as it is and
// return ops (and which node to select afterwards); the caller applies them, which also gives the
// ops that undo them.
//
// The root's children are split in two by their side. Each side is its own list of siblings:
// moving a main branch up or down never crosses to the other side, and new ranks are made between
// neighbours on the same side (the other side's ranks may lie anywhere in between).
import type { MapNode, Op, Side } from "../../shared/protocol.ts";
import { ranksAfter, ranksAtEnd, ranksBefore } from "./ranks.ts";

/** The map as a command sees it. */
export interface Ctx {
  rootId: string;
  get(id: string): MapNode | undefined;
  /** Every child, deleted ones included, in order. Ranks are computed from this. */
  children(parentId: string): readonly string[];
  newId(): string;
}

export interface Result {
  ops: Op[];
  /** the node to select afterwards */
  select?: string;
}

/** Where a node goes: its parent, rank and side. */
export interface Placement {
  parentId: string;
  rank: string;
  side: Side | null;
}

/** A node to insert, with its branch: from pasted text or an OPML file. */
export interface Draft {
  text: string;
  children: Draft[];
}

const get = (ctx: Ctx, id: string) => {
  const node = ctx.get(id);
  if (!node) throw new Error(`Unknown node ${id}`);
  return node;
};

const isLive = (ctx: Ctx, id: string) => ctx.get(id)?.deletedAt === null;

/** The siblings as ranks.ts sees them: the root's children only on one side. */
function onSide(ctx: Ctx, side: Side | null) {
  return {
    get: (id: string) => ctx.get(id),
    children: (parentId: string) =>
      parentId === ctx.rootId && side !== null
        ? ctx.children(parentId).filter((id) => ctx.get(id)?.side === side)
        : ctx.children(parentId),
  };
}

/** The live children of a node; of the root, only those on `side` if it is given. */
export function liveChildren(ctx: Ctx, parentId: string, side: Side | null = null): string[] {
  return onSide(ctx, side)
    .children(parentId)
    .filter((id) => isLive(ctx, id));
}

/** The side a node is on: its main branch's. null for the root. */
export function sideOf(ctx: Ctx, id: string): Side | null {
  for (let node = ctx.get(id); node && node.parentId !== null; node = ctx.get(node.parentId)) {
    if (node.parentId === ctx.rootId) return node.side ?? "right";
  }
  return null;
}

/** How many live nodes a branch holds, itself included. */
export function branchSize(ctx: Ctx, id: string): number {
  let n = 0;
  const stack = [id];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    n++;
    stack.push(...liveChildren(ctx, cur));
  }
  return n;
}

/** Whether `ancestor` is `id` itself or above it. */
export function isAncestorOrSelf(ctx: Ctx, ancestor: string, id: string | null): boolean {
  for (let cur = id; cur !== null;) {
    if (cur === ancestor) return true;
    cur = ctx.get(cur)?.parentId ?? null;
  }
  return false;
}

/** The op that unfolds `id` if it is folded (so what is put in it can be seen). */
const unfold = (ctx: Ctx, id: string): Op[] => (ctx.get(id)?.collapsed ? [{ op: "update", id, collapsed: false }] : []);

// ---- Adding -----------------------------------------------------------------------------------

/** A new node's place: the last child of `parentId` (of the root: the last on `side`). */
export function childPlacement(ctx: Ctx, parentId: string, side: Side): Placement {
  const mainBranch = parentId === ctx.rootId;
  const s = mainBranch ? side : null;
  return { parentId, rank: ranksAtEnd(onSide(ctx, s), parentId, 1)[0]!, side: s };
}

/** A new node's place right after (or before) `id`, a node other than the root. */
export function siblingPlacement(ctx: Ctx, id: string, before: boolean): Placement {
  const node = get(ctx, id);
  const parentId = node.parentId!;
  const tree = onSide(ctx, node.side);
  const rank = before ? ranksBefore(tree, parentId, id, 1)[0]! : ranksAfter(tree, parentId, id, 1)[0]!;
  return { parentId, rank, side: node.side };
}

/** Creates node `id` at `place` holding `text`, unfolding its parent if needed. */
export function create(ctx: Ctx, id: string, place: Placement, text: string): Result {
  return {
    ops: [...unfold(ctx, place.parentId), { op: "create", id, ...place, text }],
    select: id,
  };
}

// ---- Moving -----------------------------------------------------------------------------------

/**
 * Moves `id` (not the root) under `parentId`, right after `afterId` (null: first) among the
 * children on `side` when the parent is the root. The new parent unfolds. Null if it would go
 * inside itself or stay where it is.
 */
export function moveTo(
  ctx: Ctx,
  id: string,
  parentId: string,
  afterId: string | null,
  side: Side | null,
): Result | null {
  const node = get(ctx, id);
  if (node.parentId === null || isAncestorOrSelf(ctx, id, parentId)) return null;
  const s = parentId === ctx.rootId ? (side ?? "right") : null;
  const rank = ranksAfter(onSide(ctx, s), parentId, afterId, 1, new Set([id]))[0]!;
  // Already there: the neighbours are the same.
  const siblings = liveChildren(ctx, parentId, s).filter((k) => k !== id);
  const at = afterId === null ? 0 : siblings.indexOf(afterId) + 1;
  const now = liveChildren(ctx, parentId, s).indexOf(id);
  if (node.parentId === parentId && node.side === s && now === at) return null;
  return { ops: [...unfold(ctx, parentId), { op: "move", id, parentId, rank, side: s }], select: id };
}

/** Moves `id` one place up (-1) or down (+1) among its live siblings on its side. */
export function moveAmongSiblings(ctx: Ctx, id: string, step: -1 | 1): Result | null {
  const node = get(ctx, id);
  if (node.parentId === null) return null;
  const siblings = liveChildren(ctx, node.parentId, node.side);
  const at = siblings.indexOf(id);
  const to = at + step;
  if (at < 0 || to < 0 || to >= siblings.length) return null;
  const others = siblings.filter((k) => k !== id);
  return moveTo(ctx, id, node.parentId, to === 0 ? null : others[to - 1]!, node.side);
}

/** Moves `id` to the first (-1) or last (+1) place among its siblings on its side. */
export function moveToEnd(ctx: Ctx, id: string, end: -1 | 1): Result | null {
  const node = get(ctx, id);
  if (node.parentId === null) return null;
  const others = liveChildren(ctx, node.parentId, node.side).filter((k) => k !== id);
  return moveTo(ctx, id, node.parentId, end < 0 ? null : (others.at(-1) ?? null), node.side);
}

/** One level away from the root: `id` becomes the last child of the sibling before it. */
export function demote(ctx: Ctx, id: string): Result | null {
  const node = get(ctx, id);
  if (node.parentId === null) return null;
  const siblings = liveChildren(ctx, node.parentId, node.side);
  const at = siblings.indexOf(id);
  if (at <= 0) return null;
  const into = siblings[at - 1]!;
  return moveTo(ctx, id, into, liveChildren(ctx, into).at(-1) ?? null, null);
}

/**
 * One level toward the root: `id` goes right after its parent. A node that becomes a main branch
 * takes its old main branch's side. (A main branch crosses to the other side instead: see
 * crossSide, which needs to know where it lands.)
 */
export function promote(ctx: Ctx, id: string): Result | null {
  const node = get(ctx, id);
  if (node.parentId === null || node.parentId === ctx.rootId) return null;
  const parent = get(ctx, node.parentId);
  const side = parent.parentId === ctx.rootId ? parent.side : null;
  return moveTo(ctx, id, parent.parentId!, parent.id, side);
}

/** A main branch moves to the other side of the root, right after `afterId` there (null: first). */
export function crossSide(ctx: Ctx, id: string, afterId: string | null): Result | null {
  const node = get(ctx, id);
  if (node.parentId !== ctx.rootId) return null;
  return moveTo(ctx, id, ctx.rootId, afterId, node.side === "left" ? "right" : "left");
}

// ---- Other changes ----------------------------------------------------------------------------

export function remove(ctx: Ctx, id: string): Result | null {
  const node = get(ctx, id);
  if (node.parentId === null) return null;
  return { ops: [{ op: "delete", id }], select: node.parentId };
}

export function setText(ctx: Ctx, id: string, text: string): Result | null {
  return get(ctx, id).text === text ? null : { ops: [{ op: "update", id, text }], select: id };
}

export function setCollapsed(ctx: Ctx, id: string, collapsed: boolean): Result | null {
  const node = get(ctx, id);
  if (node.parentId === null || node.collapsed === collapsed) return null;
  return { ops: [{ op: "update", id, collapsed }], select: id };
}

/**
 * Inserts drafts (pasted text, an OPML file) as the last children of `parentId`, every node of
 * them folded but the new tops. Under the root, each new main branch goes to the side holding
 * fewer nodes so far.
 */
export function insertDrafts(ctx: Ctx, parentId: string, drafts: readonly Draft[]): Result | null {
  if (drafts.length === 0) return null;
  const ops: Op[] = [...unfold(ctx, parentId)];
  const tops: { draft: Draft; place: Placement }[] = [];
  if (parentId === ctx.rootId) {
    const size = { left: 0, right: 0 };
    for (const s of ["left", "right"] as const) {
      for (const k of liveChildren(ctx, parentId, s)) size[s] += branchSize(ctx, k);
    }
    const sides = drafts.map((d) => {
      const s: Side = size.left < size.right ? "left" : "right";
      size[s] += countDrafts([d]);
      return s;
    });
    for (const s of ["left", "right"] as const) {
      const mine = drafts.filter((_, i) => sides[i] === s);
      const ranks = ranksAtEnd(onSide(ctx, s), parentId, mine.length);
      mine.forEach((draft, i) => tops.push({ draft, place: { parentId, rank: ranks[i]!, side: s } }));
    }
  } else {
    const ranks = ranksAtEnd(ctx, parentId, drafts.length);
    drafts.forEach((draft, i) => tops.push({ draft, place: { parentId, rank: ranks[i]!, side: null } }));
  }
  // Without recursion: a pasted outline may be deep.
  const stack: { draft: Draft; place: Placement; top: boolean }[] = tops.reverse().map((t) => ({ ...t, top: true }));
  let first: string | undefined;
  while (stack.length > 0) {
    const { draft, place, top } = stack.pop()!;
    const id = ctx.newId();
    first ??= id;
    const folded = !top && draft.children.length > 0;
    ops.push({ op: "create", id, ...place, text: draft.text, ...(folded ? { collapsed: true } : {}) });
    const ranks = draft.children.length > 0 ? ranksAtEnd(ctx, id, draft.children.length) : [];
    for (let i = draft.children.length - 1; i >= 0; i--) {
      stack.push({ draft: draft.children[i]!, place: { parentId: id, rank: ranks[i]!, side: null }, top: false });
    }
  }
  return { ops, select: first };
}

/** How many nodes drafts hold, branches included. */
export function countDrafts(drafts: readonly Draft[]): number {
  let n = 0;
  const stack = [...drafts];
  while (stack.length > 0) {
    n++;
    stack.push(...stack.pop()!.children);
  }
  return n;
}

// ---- Arrows -----------------------------------------------------------------------------------

export function addArrow(ctx: Ctx, fromId: string, toId: string, label = ""): Result | null {
  if (fromId === toId) return null;
  return { ops: [{ op: "createArrow", id: ctx.newId(), fromId, toId, ...(label ? { label } : {}) }] };
}
