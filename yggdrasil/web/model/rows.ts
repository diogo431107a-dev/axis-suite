// The outline as the screen shows it: one row per visible bullet, in reading order, with its
// depth. The page renders only the rows near the viewport, so a tree of any size draws quickly.
import type { Store } from "./store.ts";
import { isShown, type View } from "./ui.ts";

export interface Row {
  id: string;
  /** 0 for the children of the zoomed-in bullet (or the top level). */
  depth: number;
}

/** The rows inside the zoomed-in bullet: shown bullets, and the children of expanded ones. */
export function visibleRows(store: Store, view: View): Row[] {
  const rows: Row[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const id of store.children(parentId)) {
      const node = store.get(id);
      if (!isShown(node, view)) continue;
      rows.push({ id, depth });
      // A search shows the matches' ancestors expanded, whatever their state.
      if (view.filter !== null || !node!.collapsed) walk(id, depth + 1);
    }
  };
  walk(view.zoom, 0);
  return rows;
}
