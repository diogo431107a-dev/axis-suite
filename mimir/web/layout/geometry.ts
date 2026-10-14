// The shapes a map is drawn with, from its layout: the branches between parents and children,
// where each line of text sits, fold badges, and relationship arrows. The page and the PNG export
// both draw from these, so they look the same.
import type { Arrow } from "../../shared/protocol.ts";
import { innerEdge, outerEdge, type Box, type Layout } from "./layout.ts";
import { BADGE, badgeWidth, styleOf } from "./theme.ts";

const r = (n: number) => Math.round(n * 10) / 10;

/** A curve from a parent's outer edge to a child's inner edge. */
export function branchPath(parent: Box, child: Box): string {
  const from = outerEdge(parent, child.side!);
  const to = innerEdge(child);
  const mid = (from.x + to.x) / 2;
  return `M${r(from.x)} ${r(from.y)}C${r(mid)} ${r(from.y)} ${r(mid)} ${r(to.y)} ${r(to.x)} ${r(to.y)}`;
}

/**
 * Every branch of the map as two paths: those from the root (drawn thicker), and the rest. With
 * `ids`, only the branches into those nodes.
 */
export function branchPaths(layout: Layout, ids: readonly string[] = layout.order): { root: string; deep: string } {
  let root = "";
  let deep = "";
  for (const id of ids) {
    const box = layout.boxes.get(id)!;
    if (box.parentId === null) continue;
    const d = branchPath(layout.boxes.get(box.parentId)!, box);
    if (box.level === 1) root += d;
    else deep += d;
  }
  return { root, deep };
}

/** A part of the map, in map coordinates. */
export interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The nodes drawn when `area` is what the window shows (and a margin): those in it, or whose branch crosses it. */
export function nodesIn(layout: Layout, area: Area): string[] {
  const meets = (b: { x: number; y: number; w: number; h: number }) =>
    b.x < area.x + area.w && b.x + b.w > area.x && b.y < area.y + area.h && b.y + b.h > area.y;
  const out: string[] = [];
  for (const id of layout.order) {
    const box = layout.boxes.get(id)!;
    // Wide enough for its fold badge, and tall enough for the branch from its parent.
    const parent = box.parentId ? layout.boxes.get(box.parentId) : undefined;
    const top = parent ? Math.min(box.y, parent.y + parent.h / 2) : box.y;
    const bottom = parent ? Math.max(box.y + box.h, parent.y + parent.h / 2) : box.y + box.h;
    if (meets({ x: box.x - 48, y: top, w: box.w + 96, h: bottom - top })) out.push(id);
  }
  return out;
}

/** Where each line of a node's text goes: x is its start (or middle, for the root), y its middle. */
export function textLines(box: Box): { x: number; y: number; text: string }[] {
  const style = styleOf(box.level);
  const x = box.level === 0 ? box.x + box.w / 2 : box.x + style.padX;
  return box.lines.map((text, i) => ({ x, y: box.y + style.padY + (i + 0.5) * style.lineHeight, text }));
}

/** The "+12" badge beside a folded node, on its outer side. Null if it hides nothing. */
export function badgeRect(box: Box): { x: number; y: number; w: number; h: number } | null {
  if (box.hidden === 0 || box.side === null) return null;
  const w = badgeWidth(box.hidden);
  const x = box.side === "right" ? box.x + box.w + BADGE.gap : box.x - BADGE.gap - w;
  return { x, y: box.y + box.h / 2 - BADGE.height / 2, w, h: BADGE.height };
}

/** The point where a line from the box's centre toward `p` leaves the box (a little outside it). */
function exitPoint(b: Box, p: { x: number; y: number }, pad = 3): { x: number; y: number } {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const t = Math.min(
    dx === 0 ? Infinity : (b.w / 2 + pad) / Math.abs(dx),
    dy === 0 ? Infinity : (b.h / 2 + pad) / Math.abs(dy),
  );
  return { x: cx + dx * Math.min(t, 1), y: cy + dy * Math.min(t, 1) };
}

export interface ArrowShape {
  d: string;
  /** where the label goes */
  label: { x: number; y: number };
  start: { x: number; y: number };
  end: { x: number; y: number };
}

/** How wide an arrow's label pill is drawn. */
export const labelWidth = (label: string) => label.length * 6.5 + 12;

/** A relationship arrow from one box to another: a curve bowed away from the map's centre. */
export function arrowShape(from: Box, to: Box): ArrowShape {
  const a = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const b = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const bow = Math.min(90, length * 0.3);
  // The normal pointing away from the root (at 0, 0).
  let nx = -(b.y - a.y) / length;
  let ny = (b.x - a.x) / length;
  if ((mid.x + nx) ** 2 + (mid.y + ny) ** 2 < (mid.x - nx) ** 2 + (mid.y - ny) ** 2) {
    nx = -nx;
    ny = -ny;
  }
  const c = { x: mid.x + nx * bow, y: mid.y + ny * bow };
  const start = exitPoint(from, c);
  const end = exitPoint(to, c, 6);
  return {
    d: `M${r(start.x)} ${r(start.y)}Q${r(c.x)} ${r(c.y)} ${r(end.x)} ${r(end.y)}`,
    label: { x: r(0.25 * start.x + 0.5 * c.x + 0.25 * end.x), y: r(0.25 * start.y + 0.5 * c.y + 0.25 * end.y) },
    start,
    end,
  };
}

/**
 * Everything drawn: the layout's bounds, grown to hold the arrows (which bow out past the nodes)
 * and their labels.
 */
export function drawnBounds(
  layout: Layout,
  arrows: readonly ShownArrow[],
): { x: number; y: number; w: number; h: number } {
  let { x: minX, y: minY } = layout.bounds;
  let maxX = minX + layout.bounds.w;
  let maxY = minY + layout.bounds.h;
  for (const a of arrows) {
    const shape = arrowShape(a.from, a.to);
    // The curve's farthest point from its ends is about where the label goes.
    const half = a.arrow.label ? labelWidth(a.arrow.label) / 2 : 4;
    const points = [shape.start, shape.end, shape.label];
    for (const p of points) {
      minX = Math.min(minX, p.x - (p === shape.label ? half : 4));
      maxX = Math.max(maxX, p.x + (p === shape.label ? half : 4));
      minY = Math.min(minY, p.y - 12);
      maxY = Math.max(maxY, p.y + 12);
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** An arrow as drawn: its ends may stand in for nodes folded away. */
export interface ShownArrow {
  arrow: Arrow;
  from: Box;
  to: Box;
  /** an end is folded away, so the arrow points at a node above it */
  dimmed: boolean;
}

/**
 * The arrows to draw: those with both ends live. An end inside a folded branch is drawn at the
 * nearest node shown above it; an arrow whose two ends fold into the same node isn't drawn.
 */
export function shownArrows(
  layout: Layout,
  arrows: Iterable<Arrow>,
  parentOf: (id: string) => string | null | undefined,
  isLive: (id: string) => boolean,
): ShownArrow[] {
  const shownAt = (id: string): string | null => {
    for (let cur: string | null | undefined = id; cur; cur = parentOf(cur)) if (layout.boxes.has(cur)) return cur;
    return null;
  };
  const out: ShownArrow[] = [];
  for (const arrow of arrows) {
    if (arrow.deletedAt !== null || !isLive(arrow.fromId) || !isLive(arrow.toId)) continue;
    const from = shownAt(arrow.fromId);
    const to = shownAt(arrow.toId);
    if (!from || !to || from === to) continue;
    out.push({
      arrow,
      from: layout.boxes.get(from)!,
      to: layout.boxes.get(to)!,
      dimmed: from !== arrow.fromId || to !== arrow.toId,
    });
  }
  return out;
}
