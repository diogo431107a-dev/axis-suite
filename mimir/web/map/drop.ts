// Where a dragged node lands, from the layout and the pointer (in map coordinates). The dragged
// branch is never a target, so a node can't be dropped inside itself.
//   - On the root: a main branch, on the side of the root the pointer is on.
//   - On another node: its last child.
//   - Near a node: past its outer edge (when it shows no children), its child; above or below it,
//     its sibling before or after.
import type { Side } from "../../shared/protocol.ts";
import type { Box, Layout } from "../layout/layout.ts";
import { GAP } from "../layout/theme.ts";

export interface Drop {
  parentId: string;
  /** The sibling it goes after (null: first); undefined: after the last child, shown or not. */
  afterId: string | null | undefined;
  /** The side, for a main branch. */
  side: Side | null;
  /** What the page shows: the node it goes into, or a line where it goes. */
  into: string | null;
  line: { x: number; y: number; w: number } | null;
}

/** How far from a node (in screen px) a drop still counts as near it. */
const REACH = 72;

const inside = (b: Box, x: number, y: number) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;

/** Distance from a point to a box, 0 inside. */
function distance(b: Box, x: number, y: number): number {
  const dx = Math.max(b.x - x, 0, x - (b.x + b.w));
  const dy = Math.max(b.y - y, 0, y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

/** The dragged node and everything shown under it. */
function branchOf(layout: Layout, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    out.add(cur);
    stack.push(...(layout.children.get(cur) ?? []));
  }
  return out;
}

/** A line between siblings: under `above`, or over `below`, as wide as the node it is next to. */
function lineBetween(above: Box | undefined, below: Box | undefined, gap: number): Drop["line"] {
  const ref = above ?? below;
  if (!ref) return null;
  const y = above ? above.y + above.h + gap / 2 : below!.y - gap / 2;
  return { x: ref.x, y, w: ref.w };
}

/**
 * Where a node dropped at (x, y) goes, or null if nowhere (too far from everything). `k` is the
 * zoom, so the reach stays the same on screen.
 */
export function dropTarget(layout: Layout, draggedId: string, x: number, y: number, k: number): Drop | null {
  const dragged = branchOf(layout, draggedId);
  const rootId = layout.order[0]!;
  const root = layout.boxes.get(rootId)!;

  /** As a main branch on `side`, placed by height among that side's others. */
  const asMainBranch = (side: Side): Drop => {
    const mains = (layout.children.get(rootId) ?? []).filter(
      (id) => !dragged.has(id) && layout.boxes.get(id)!.side === side,
    );
    const boxes = mains.map((id) => layout.boxes.get(id)!);
    const at = boxes.filter((b) => b.y + b.h / 2 < y).length;
    const line = lineBetween(boxes[at - 1], boxes[at], GAP.main) ?? {
      x: side === "right" ? root.x + root.w + GAP.root : root.x - GAP.root - 60,
      y: root.y + root.h / 2,
      w: 60,
    };
    return { parentId: rootId, afterId: at === 0 ? null : mains[at - 1]!, side, into: null, line };
  };

  if (inside(root, x, y)) return asMainBranch(x < root.x + root.w / 2 ? "left" : "right");

  let best: Box | null = null;
  let bestDistance = REACH / k;
  for (const id of layout.order) {
    if (dragged.has(id)) continue;
    const b = layout.boxes.get(id)!;
    const d = distance(b, x, y);
    if (d < bestDistance || (d === 0 && bestDistance === 0)) {
      best = b;
      bestDistance = d;
      if (d === 0) break;
    }
  }
  if (!best) return null;
  if (best.id === rootId) return asMainBranch(x < root.x + root.w / 2 ? "left" : "right");

  const into = (b: Box): Drop => ({ parentId: b.id, afterId: undefined, side: null, into: b.id, line: null });
  if (bestDistance === 0) return into(best);
  const side = best.side!;
  const beyond = side === "right" ? x > best.x + best.w : x < best.x;
  if (beyond && best.kids === 0) return into(best);

  // A sibling of `best`, before or after it.
  const parentId = best.parentId!;
  const siblings = (layout.children.get(parentId) ?? []).filter(
    (id) => !dragged.has(id) && layout.boxes.get(id)!.side === side,
  );
  const at = siblings.indexOf(best.id);
  const before = y < best.y + best.h / 2;
  const slot = before ? at : at + 1;
  const gap = best.level === 1 ? GAP.main : GAP.down;
  const boxes = siblings.map((id) => layout.boxes.get(id)!);
  return {
    parentId,
    afterId: slot === 0 ? null : siblings[slot - 1]!,
    side: parentId === rootId ? side : null,
    into: null,
    line: lineBetween(boxes[slot - 1], boxes[slot], gap),
  };
}
