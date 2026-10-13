// Where every node of a map goes. The root sits at the centre (0, 0); its children grow to the
// right or the left, as their side says, and everything under a main branch grows the same way.
//
// Each node owns a horizontal band (its "block") as tall as the larger of itself and its children's
// blocks stacked with gaps; it is centred on that band, and its children's stack is centred on
// it. So nodes of the same depth on the same side never overlap, and the map never needs fixing
// up. Coordinates are CSS px at 100% zoom, y pointing down. Pure, and without recursion: a map
// may be thousands of levels deep.
import type { Side } from "../../shared/protocol.ts";
import type { Measure } from "./measure.ts";
import { BADGE, GAP, badgeWidth } from "./theme.ts";

/** The map as the layout sees it: live nodes only, children in order. */
export interface LayoutTree {
  rootId: string;
  get(id: string): { text: string; side: Side | null; collapsed: boolean } | undefined;
  /** The live children, in order. */
  children(id: string): readonly string[];
}

export interface Box {
  id: string;
  parentId: string | null;
  /** 0 for the root, 1 for a main branch, … */
  level: number;
  /** The side of the branch it is in; null for the root. */
  side: Side | null;
  /** The top left corner, and the size. */
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
  /** How many live nodes a folded node hides (0 if it hides none). */
  hidden: number;
  /** How many children are shown. */
  kids: number;
}

export interface Layout {
  boxes: Map<string, Box>;
  /** Every shown node, each before its children: the order to draw them in. */
  order: string[];
  /** The shown children of each shown node, in order (the root's: both sides, mixed). */
  children: Map<string, string[]>;
  /** The shown nodes of each side and depth, top to bottom, keyed "right:2". */
  columns: Map<string, string[]>;
  /** How tall each side's stack of main branches is. */
  sideHeight: { left: number; right: number };
  /** Everything drawn, fold badges included. */
  bounds: { x: number; y: number; w: number; h: number };
}

export const columnKey = (side: Side, level: number) => `${side}:${level}`;

/** The vertical gap between siblings at `level`. */
const gapDown = (level: number) => (level === 1 ? GAP.main : GAP.down);

/** How many live nodes are under `id`. */
function descendants(tree: LayoutTree, id: string): number {
  let n = 0;
  const stack = [...tree.children(id)];
  while (stack.length > 0) {
    n++;
    stack.push(...tree.children(stack.pop()!));
  }
  return n;
}

const sameBox = (a: Box, b: Box) =>
  a.x === b.x &&
  a.y === b.y &&
  a.w === b.w &&
  a.h === b.h &&
  a.level === b.level &&
  a.side === b.side &&
  a.parentId === b.parentId &&
  a.hidden === b.hidden &&
  a.kids === b.kids &&
  a.lines.length === b.lines.length &&
  a.lines.every((l, i) => l === b.lines[i]);

/**
 * Lays the map out. Boxes that come out exactly as in `prev` are `prev`'s own objects, so whatever
 * draws them can tell at a glance which ones changed.
 */
export function layoutMap(tree: LayoutTree, measure: Measure, prev?: Layout): Layout {
  const rootId = tree.rootId;
  const boxes = new Map<string, Box>();
  const order: string[] = [];
  const shownKids = new Map<string, string[]>();

  // 1. Every shown node, in pre-order, measured.
  const stack: { id: string; parentId: string | null; level: number; side: Side | null }[] = [
    { id: rootId, parentId: null, level: 0, side: null },
  ];
  while (stack.length > 0) {
    const { id, parentId, level, side } = stack.pop()!;
    const node = tree.get(id);
    if (!node) continue;
    const open = level === 0 || !node.collapsed;
    const kids = open ? tree.children(id).filter((k) => tree.get(k) !== undefined) : [];
    const { lines, w, h } = measure(node.text, level);
    boxes.set(id, {
      id,
      parentId,
      level,
      side,
      x: 0,
      y: 0,
      w,
      h,
      lines,
      hidden: open ? 0 : descendants(tree, id),
      kids: kids.length,
    });
    shownKids.set(id, kids);
    order.push(id);
    for (let i = kids.length - 1; i >= 0; i--) {
      const kid = kids[i]!;
      const kidSide = level === 0 ? (tree.get(kid)?.side ?? "right") : side;
      stack.push({ id: kid, parentId: id, level: level + 1, side: kidSide });
    }
  }

  // 2. The height of each node's band, children before parents.
  const block = new Map<string, number>();
  const stackHeight = (ids: readonly string[], level: number) =>
    ids.length === 0 ? 0 : ids.reduce((sum, k) => sum + block.get(k)!, 0) + gapDown(level) * (ids.length - 1);
  for (let i = order.length - 1; i > 0; i--) {
    const id = order[i]!;
    const box = boxes.get(id)!;
    block.set(id, Math.max(box.h, stackHeight(shownKids.get(id)!, box.level + 1)));
  }
  const mains = shownKids.get(rootId) ?? [];
  const onSide = (side: Side) => mains.filter((k) => boxes.get(k)!.side === side);
  const sideHeight = { left: stackHeight(onSide("left"), 1), right: stackHeight(onSide("right"), 1) };

  // 3. Positions, parents before children.
  const root = boxes.get(rootId)!;
  root.x = -root.w / 2;
  root.y = -root.h / 2;
  const place: { id: string; top: number }[] = [];
  for (const side of ["left", "right"] as const) {
    let top = -sideHeight[side] / 2;
    for (const k of onSide(side)) {
      place.push({ id: k, top });
      top += block.get(k)! + GAP.main;
    }
  }
  while (place.length > 0) {
    const { id, top } = place.pop()!;
    const box = boxes.get(id)!;
    const parent = boxes.get(box.parentId!)!;
    const cy = top + block.get(id)! / 2;
    const across = box.level === 1 ? GAP.root : GAP.across;
    box.y = cy - box.h / 2;
    box.x = box.side === "left" ? parent.x - across - box.w : parent.x + parent.w + across;
    const kids = shownKids.get(id)!;
    let childTop = cy - stackHeight(kids, box.level + 1) / 2;
    for (const k of kids) {
      place.push({ id: k, top: childTop });
      childTop += block.get(k)! + gapDown(box.level + 1);
    }
  }

  // 4. Columns, bounds, and the boxes that didn't change.
  const columns = new Map<string, string[]>();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of order) {
    let box = boxes.get(id)!;
    const old = prev?.boxes.get(id);
    if (old && sameBox(old, box)) boxes.set(id, (box = old));
    if (box.side) {
      const key = columnKey(box.side, box.level);
      const column = columns.get(key);
      if (column) column.push(id);
      else columns.set(key, [id]);
    }
    const badge = box.hidden > 0 ? BADGE.gap + badgeWidth(box.hidden) : 0;
    minX = Math.min(minX, box.x - (box.side === "left" ? badge : 0));
    maxX = Math.max(maxX, box.x + box.w + (box.side === "right" ? badge : 0));
    minY = Math.min(minY, box.y);
    maxY = Math.max(maxY, box.y + box.h);
  }
  for (const column of columns.values()) column.sort((a, b) => boxes.get(a)!.y - boxes.get(b)!.y);

  return {
    boxes,
    order,
    children: shownKids,
    columns,
    sideHeight,
    bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
  };
}

/** The centre of a box. */
export const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** The point where a branch leaves a box toward its children (on its outer side). */
export function outerEdge(b: Box, side: Side): { x: number; y: number } {
  return { x: side === "left" ? b.x : b.x + b.w, y: b.y + b.h / 2 };
}

/** The point where the branch from the parent comes into a box. */
export function innerEdge(b: Box): { x: number; y: number } {
  return { x: b.side === "left" ? b.x + b.w : b.x, y: b.y + b.h / 2 };
}
