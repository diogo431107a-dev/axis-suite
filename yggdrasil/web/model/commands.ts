// What each editing action does to the tree, as ops. Pure functions: they read the outline as it
// is shown and return ops (and where the caret goes); the caller applies them, which also gives
// the ops that undo them.
import { generateNKeysBetween } from "fractional-indexing";
import type { Node, NodeFields, Op } from "../../shared/protocol.ts";
import { ranksAfter, ranksAtEnd, ranksBefore } from "./ranks.ts";

/** The outline as a command sees it. */
export interface Ctx {
  get(id: string): Node | undefined;
  /** Every child, deleted ones included, in order. Ranks are computed from this. */
  children(parentId: string | null): readonly string[];
  /** The children shown on screen, in order. */
  shown(parentId: string | null): readonly string[];
  /** Whether a node's children are shown: not collapsed, or a search is open. */
  expanded(id: string): boolean;
  /** The zoomed-in bullet, or null for the whole tree. Commands never leave it. */
  root: string | null;
  newId(): string;
  now(): string;
}

/** Where the caret goes afterwards: a bullet and an offset in its content. */
export interface Caret {
  id: string;
  offset: number;
}

export interface Result {
  ops: Op[];
  caret?: Caret;
}

/** A bullet to insert, with its subtree: from pasted text or an OPML file. */
export interface Draft {
  content: string;
  note?: string;
  completed?: boolean;
  children: Draft[];
}

const get = (ctx: Ctx, id: string) => {
  const node = ctx.get(id);
  if (!node) throw new Error(`Unknown node ${id}`);
  return node;
};

const liveChildren = (ctx: Ctx, id: string) => ctx.children(id).filter((k) => ctx.get(k)?.deletedAt === null);

// ---- Moving around --------------------------------------------------------------------------

function lastShownDescendant(ctx: Ctx, id: string): string {
  for (let cur = id; ;) {
    const kids = ctx.expanded(cur) ? ctx.shown(cur) : [];
    if (kids.length === 0) return cur;
    cur = kids[kids.length - 1]!;
  }
}

/** The bullet shown above `id`: possibly the zoomed-in bullet's title. null at the very top. */
export function above(ctx: Ctx, id: string): string | null {
  if (id === ctx.root) return null;
  const node = get(ctx, id);
  const sibs = ctx.shown(node.parentId);
  const i = sibs.indexOf(id);
  if (i > 0) return lastShownDescendant(ctx, sibs[i - 1]!);
  return node.parentId;
}

/** The bullet shown below `id`, or null at the very end. */
export function below(ctx: Ctx, id: string, intoChildren = true): string | null {
  if (intoChildren && (id === ctx.root || ctx.expanded(id))) {
    const kids = ctx.shown(id);
    if (kids.length > 0) return kids[0]!;
  }
  for (let cur: string | null = id; cur !== null && cur !== ctx.root;) {
    const node = get(ctx, cur);
    const sibs = ctx.shown(node.parentId);
    const i = sibs.indexOf(cur);
    if (i >= 0 && i < sibs.length - 1) return sibs[i + 1]!;
    cur = node.parentId;
  }
  return null;
}

/** Whether `ancestor` is `id` or above it. */
export function isAncestorOrSelf(ctx: Ctx, ancestor: string, id: string | null): boolean {
  for (let cur = id; cur !== null; cur = ctx.get(cur)?.parentId ?? null) if (cur === ancestor) return true;
  return false;
}

// ---- Typing ---------------------------------------------------------------------------------

/**
 * Enter with the caret (or selection) at start..end: the text after it moves to a new bullet
 * below, or to a new first child when the bullet's children are shown. At the start of a
 * non-empty bullet, an empty one is inserted above instead.
 */
export function enter(ctx: Ctx, id: string, start: number, end: number): Result {
  const node = get(ctx, id);
  const before = node.content.slice(0, start);
  const after = node.content.slice(end);
  const newId = ctx.newId();
  const created = (parentId: string | null, rank: string): Op =>
    after ? { op: "create", id: newId, parentId, rank, content: after } : { op: "create", id: newId, parentId, rank };

  if (start === 0 && end === 0 && node.content !== "" && id !== ctx.root) {
    const [rank] = ranksBefore(ctx, node.parentId, id, 1);
    return { ops: [{ op: "create", id: newId, parentId: node.parentId, rank: rank! }], caret: { id, offset: 0 } };
  }
  const ops: Op[] = before === node.content ? [] : [{ op: "update", id, content: before }];
  if (id === ctx.root || (ctx.expanded(id) && ctx.shown(id).length > 0)) {
    ops.push(created(id, ranksAfter(ctx, id, null, 1)[0]!));
  } else {
    ops.push(created(node.parentId, ranksAfter(ctx, node.parentId, id, 1)[0]!));
  }
  return { ops, caret: { id: newId, offset: 0 } };
}

/**
 * Joins `fromId` onto the end of `intoId` (the bullet above it): text, note and children.
 * Backspace at the start of a bullet, or Delete at the end of the one above.
 */
export function merge(ctx: Ctx, intoId: string, fromId: string): Result {
  const into = get(ctx, intoId);
  const from = get(ctx, fromId);
  const fields: Partial<NodeFields> = {};
  if (from.content) fields.content = into.content + from.content;
  if (from.note) fields.note = into.note ? `${into.note}\n${from.note}` : from.note;
  const moves: Op[] = [];
  const kids = liveChildren(ctx, fromId);
  if (kids.length > 0) {
    const exclude = new Set(kids);
    // A first child merged into its parent leaves its children where it was.
    const ranks =
      from.parentId === intoId
        ? ranksAfter(ctx, intoId, fromId, kids.length, exclude)
        : ranksAtEnd(ctx, intoId, kids.length, exclude);
    kids.forEach((k, i) => moves.push({ op: "move", id: k, parentId: intoId, rank: ranks[i]! }));
    if (into.collapsed) fields.collapsed = false;
  }
  const ops: Op[] = Object.keys(fields).length > 0 ? [{ op: "update", id: intoId, ...fields }] : [];
  ops.push(...moves, { op: "delete", id: fromId });
  return { ops, caret: { id: intoId, offset: into.content.length } };
}

/** Backspace at the start: deletes an empty bullet, or merges it into the one above. */
export function backspaceAtStart(ctx: Ctx, id: string): Result | null {
  if (id === ctx.root) return null;
  const node = get(ctx, id);
  const prev = above(ctx, id);
  if (node.content === "" && node.note === "" && liveChildren(ctx, id).length === 0) {
    if (prev !== null)
      return { ops: [{ op: "delete", id }], caret: { id: prev, offset: get(ctx, prev).content.length } };
    const next = below(ctx, id, false);
    return next === null ? null : { ops: [{ op: "delete", id }], caret: { id: next, offset: 0 } };
  }
  if (prev === null || prev === ctx.root) return null;
  return merge(ctx, prev, id);
}

/** Delete at the end: merges the bullet below into this one. */
export function deleteAtEnd(ctx: Ctx, id: string): Result | null {
  const next = below(ctx, id);
  return next === null ? null : merge(ctx, id, next);
}

// ---- Structure (on one bullet or a block of siblings) ---------------------------------------

const moveAll = (ids: readonly string[], parentId: string | null, ranks: string[]): Op[] =>
  ids.map((id, i) => ({ op: "move", id, parentId, rank: ranks[i]! }));

const expand = (ctx: Ctx, id: string): Op[] => (get(ctx, id).collapsed ? [{ op: "update", id, collapsed: false }] : []);

/** Tab: the bullets become the last children of the sibling above them. */
export function indent(ctx: Ctx, ids: readonly string[]): Result | null {
  const first = get(ctx, ids[0]!);
  const sibs = ctx.shown(first.parentId);
  const i = sibs.indexOf(first.id);
  if (i <= 0) return null;
  const target = sibs[i - 1]!;
  return {
    ops: [...expand(ctx, target), ...moveAll(ids, target, ranksAtEnd(ctx, target, ids.length, new Set(ids)))],
  };
}

/** Shift+Tab: the bullets move out of their parent, to right after it. */
export function outdent(ctx: Ctx, ids: readonly string[]): Result | null {
  const parentId = get(ctx, ids[0]!).parentId;
  if (parentId === null || parentId === ctx.root) return null;
  const parent = get(ctx, parentId);
  return {
    ops: moveAll(ids, parent.parentId, ranksAfter(ctx, parent.parentId, parentId, ids.length, new Set(ids))),
  };
}

/**
 * Ctrl+Shift+Up: the bullets swap places with the sibling above. At the top of their parent they
 * leave it: into the end of the parent's previous sibling, or else to just before the parent.
 */
export function moveUp(ctx: Ctx, ids: readonly string[]): Result | null {
  const first = get(ctx, ids[0]!);
  const exclude = new Set(ids);
  const sibs = ctx.shown(first.parentId);
  const i = sibs.indexOf(first.id);
  if (i > 0)
    return { ops: moveAll(ids, first.parentId, ranksBefore(ctx, first.parentId, sibs[i - 1]!, ids.length, exclude)) };
  if (first.parentId === null || first.parentId === ctx.root) return null;
  const parent = get(ctx, first.parentId);
  const parentSibs = ctx.shown(parent.parentId);
  const pi = parentSibs.indexOf(parent.id);
  if (pi > 0) {
    const target = parentSibs[pi - 1]!;
    return { ops: [...expand(ctx, target), ...moveAll(ids, target, ranksAtEnd(ctx, target, ids.length, exclude))] };
  }
  return { ops: moveAll(ids, parent.parentId, ranksBefore(ctx, parent.parentId, parent.id, ids.length, exclude)) };
}

/** Ctrl+Shift+Down: the mirror image of moveUp. */
export function moveDown(ctx: Ctx, ids: readonly string[]): Result | null {
  const first = get(ctx, ids[0]!);
  const last = ids[ids.length - 1]!;
  const exclude = new Set(ids);
  const sibs = ctx.shown(first.parentId);
  const j = sibs.indexOf(last);
  if (j >= 0 && j < sibs.length - 1) {
    return { ops: moveAll(ids, first.parentId, ranksAfter(ctx, first.parentId, sibs[j + 1]!, ids.length, exclude)) };
  }
  if (first.parentId === null || first.parentId === ctx.root) return null;
  const parent = get(ctx, first.parentId);
  const parentSibs = ctx.shown(parent.parentId);
  const pi = parentSibs.indexOf(parent.id);
  if (pi < parentSibs.length - 1) {
    const target = parentSibs[pi + 1]!;
    return {
      ops: [...expand(ctx, target), ...moveAll(ids, target, ranksAfter(ctx, target, null, ids.length, exclude))],
    };
  }
  return { ops: moveAll(ids, parent.parentId, ranksAfter(ctx, parent.parentId, parent.id, ids.length, exclude)) };
}

/** Drag and drop: the bullets go under `parentId`, right after `afterId` (null: first). */
export function moveTo(
  ctx: Ctx,
  ids: readonly string[],
  parentId: string | null,
  afterId: string | null,
): Result | null {
  if (ids.some((id) => isAncestorOrSelf(ctx, id, parentId))) return null;
  const exclude = new Set(ids);
  if (afterId !== null && exclude.has(afterId)) return null;
  return {
    ops: [
      ...(parentId === null ? [] : expand(ctx, parentId)),
      ...moveAll(ids, parentId, ranksAfter(ctx, parentId, afterId, ids.length, exclude)),
    ],
  };
}

/** Deletes the bullets (and so everything under them). The caret goes to the bullet above. */
export function remove(ctx: Ctx, ids: readonly string[]): Result | null {
  const targets = ids.filter((id) => id !== ctx.root);
  if (targets.length === 0) return null;
  const ops: Op[] = targets.map((id) => ({ op: "delete", id }));
  const prev = above(ctx, targets[0]!);
  if (prev !== null) return { ops, caret: { id: prev, offset: get(ctx, prev).content.length } };
  const next = below(ctx, targets[targets.length - 1]!, false);
  return next === null ? { ops } : { ops, caret: { id: next, offset: 0 } };
}

/** Ctrl+Enter: completes the bullets, or uncompletes them if all are completed already. */
export function toggleComplete(ctx: Ctx, ids: readonly string[]): Result {
  const nodes = ids.map((id) => get(ctx, id));
  const allDone = nodes.every((n) => n.completedAt !== null);
  const now = ctx.now();
  return {
    ops: nodes
      .filter((n) => allDone || n.completedAt === null)
      .map((n) => ({ op: "update", id: n.id, completedAt: allDone ? null : now })),
  };
}

export function setCollapsed(ctx: Ctx, id: string, collapsed: boolean): Result | null {
  const node = get(ctx, id);
  if (node.collapsed === collapsed || (collapsed && liveChildren(ctx, id).length === 0)) return null;
  return { ops: [{ op: "update", id, collapsed }] };
}

export function toggleStar(ctx: Ctx, id: string): Result {
  return { ops: [{ op: "update", id, starred: !get(ctx, id).starred }] };
}

// ---- Inserting whole subtrees (paste, import) -----------------------------------------------

/** Creates for drafts under parentId after afterId, parents before children. */
export function insertDrafts(
  ctx: Ctx,
  parentId: string | null,
  afterId: string | null,
  drafts: readonly Draft[],
): Result & { ids: string[] } {
  const ops: Op[] = [];
  const now = ctx.now();
  const add = (draft: Draft, parent: string | null, rank: string): string => {
    const id = ctx.newId();
    const op: Op = { op: "create", id, parentId: parent, rank };
    if (draft.content) op.content = draft.content;
    if (draft.note) op.note = draft.note;
    if (draft.completed) op.completedAt = now;
    ops.push(op);
    addAll(draft.children, id, generateNKeysBetween(null, null, draft.children.length));
    return id;
  };
  const addAll = (list: readonly Draft[], parent: string | null, ranks: string[]) =>
    list.map((d, i) => add(d, parent, ranks[i]!));
  const ids = addAll(drafts, parentId, ranksAfter(ctx, parentId, afterId, drafts.length));
  return { ops, ids };
}

/**
 * Pasting several lines into bullet `id`: they become bullets after it. If it is empty, the
 * first pasted bullet takes its place. The caret goes to the end of the last one.
 */
export function pasteDrafts(ctx: Ctx, id: string, drafts: readonly Draft[]): Result | null {
  if (drafts.length === 0) return null;
  const node = get(ctx, id);
  if (id === ctx.root) {
    const { ops, ids } = insertDrafts(ctx, id, null, drafts);
    return { ops, caret: { id: ids.at(-1)!, offset: drafts.at(-1)!.content.length } };
  }
  const ops: Op[] = [];
  let rest = drafts;
  let lastId = id;
  if (node.content === "" && node.note === "" && liveChildren(ctx, id).length === 0) {
    const [first, ...others] = drafts;
    const fields: Partial<NodeFields> = { content: first!.content };
    if (first!.note) fields.note = first!.note;
    if (first!.completed) fields.completedAt = ctx.now();
    ops.push({ op: "update", id, ...fields });
    ops.push(...insertDrafts(ctx, id, null, first!.children).ops);
    rest = others;
  }
  if (rest.length > 0) {
    const inserted = insertDrafts(ctx, node.parentId, id, rest);
    ops.push(...inserted.ops);
    lastId = inserted.ids.at(-1)!;
  }
  return { ops, caret: { id: lastId, offset: drafts.at(-1)!.content.length } };
}
