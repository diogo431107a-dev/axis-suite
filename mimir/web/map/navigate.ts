// Moving the selection with the arrow keys, from the layout alone. ← and → follow the branches:
// "outward" (away from the root: → on the right side, ← on the left) goes to a child, "inward"
// to the parent. ↑ and ↓ go to the nearest node above or below at the same depth on the same side,
// which may be a cousin. From the root, ← and → enter the left or right side.
import type { Side } from "../../shared/protocol.ts";
import { columnKey, type Box, type Layout } from "../layout/layout.ts";

export type Dir = "up" | "down" | "left" | "right";

const centreY = (b: Box) => b.y + b.h / 2;

/** The id among `ids` whose box centre is nearest to `y` (the upper one on a tie). */
function nearest(layout: Layout, ids: readonly string[], y: number): string | null {
  let best: string | null = null;
  let distance = Infinity;
  for (const id of ids) {
    const d = Math.abs(centreY(layout.boxes.get(id)!) - y);
    if (d < distance) {
      best = id;
      distance = d;
    }
  }
  return best;
}

/** Whether `dir` points away from the root on `side`. */
export const isOutward = (side: Side, dir: Dir) => (side === "right" ? dir === "right" : dir === "left");

/**
 * The node the selection moves to from `from`, or null if there is none that way. `lastChild`
 * remembers, per parent, the child the selection last came back from, so ← then → returns there.
 */
export function navigate(
  layout: Layout,
  from: string,
  dir: Dir,
  lastChild: ReadonlyMap<string, string> = new Map(),
): string | null {
  const box = layout.boxes.get(from);
  if (!box) return null;
  const kids = layout.children.get(from) ?? [];
  const child = (candidates: readonly string[]) => {
    const remembered = lastChild.get(from);
    if (remembered && candidates.includes(remembered)) return remembered;
    return nearest(layout, candidates, centreY(box));
  };

  if (box.side === null) {
    // The root.
    if (dir === "up" || dir === "down") return null;
    return child(kids.filter((k) => layout.boxes.get(k)!.side === dir));
  }
  if (dir === "up" || dir === "down") {
    const column = layout.columns.get(columnKey(box.side, box.level)) ?? [];
    const at = column.indexOf(from);
    return column[at + (dir === "up" ? -1 : 1)] ?? null;
  }
  return isOutward(box.side, dir) ? child(kids) : box.parentId;
}
