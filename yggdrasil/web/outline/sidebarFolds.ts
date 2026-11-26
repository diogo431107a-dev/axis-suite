// The sidebar tree's state and helpers. Which bullets are unfolded there is its own, apart from
// the outline's collapsed bullets: folding in the sidebar never changes the outline. Kept in this
// browser only.
import { useEffect, useSyncExternalStore } from "react";
import type { Node } from "../../shared/protocol.ts";
import type { Outliner } from "../model/outliner.ts";
import { useOutliner } from "./hooks.ts";

const KEY = "yggdrasil.sidebarOpen";

/** Tells the bullets still there, for forgetting the others. */
export const exists = (o: Outliner) => (id: string) => o.store.get(id)?.deletedAt === null;

function read(): ReadonlySet<string> {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

let unfolded = read();
const listeners = new Set<() => void>();

function set(next: Set<string>, exists: (id: string) => boolean): void {
  for (const id of next) if (!exists(id)) next.delete(id);
  unfolded = next;
  try {
    localStorage.setItem(KEY, JSON.stringify([...next]));
  } catch {
    // a convenience only
  }
  for (const l of listeners) l();
}

export const sidebarFolds = {
  isOpen: (id: string) => unfolded.has(id),

  /** Unfolds or folds bullet id. `exists` tells the bullets still there: the others are forgotten. */
  toggle(id: string, exists: (id: string) => boolean): void {
    const next = new Set(unfolded);
    if (!next.delete(id)) next.add(id);
    set(next, exists);
  },

  /** Unfolds the bullets (the path to the zoomed-in bullet; a folded bullet held under a drag). */
  open(ids: readonly string[], exists: (id: string) => boolean): void {
    if (ids.every((id) => unfolded.has(id))) return;
    set(new Set([...unfolded, ...ids]), exists);
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** The unfolded bullets, re-rendering when they change. */
export function useSidebarFolds(): ReadonlySet<string> {
  return useSyncExternalStore(sidebarFolds.subscribe, () => unfolded);
}

/** The children the sidebar lists. */
export function sidebarChildren(o: Outliner, id: string, showCompleted: boolean): Node[] {
  return o.store
    .children(id)
    .map((k) => o.store.get(k)!)
    .filter((n) => n.deletedAt === null && (showCompleted || n.completedAt === null));
}

/** Unfolds the path to the zoomed-in bullet, and brings its row into view. */
export function useRevealZoom(zoom: string | null): void {
  const o = useOutliner();
  useEffect(() => {
    if (zoom === null) return;
    const path: string[] = [];
    for (let cur = o.store.get(zoom)?.parentId ?? null; cur !== null; cur = o.store.get(cur)?.parentId ?? null) {
      path.push(cur);
    }
    sidebarFolds.open(path, exists(o));
    // Once the unfolded rows are drawn.
    requestAnimationFrame(() =>
      document.querySelector(`nav [data-move-target="${CSS.escape(zoom)}"]`)?.scrollIntoView({ block: "nearest" }),
    );
  }, [o, zoom]);
}
