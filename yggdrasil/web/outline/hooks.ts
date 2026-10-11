// React's view of the model. Each hook subscribes to as little as possible, so typing in one
// bullet re-renders that bullet only.
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import type { Node } from "../../shared/protocol.ts";
import type { Outliner } from "../model/outliner.ts";
import type { SyncState } from "../model/sync.ts";
import { isShown, type Caret, type View } from "../model/ui.ts";

export const OutlinerContext = createContext<Outliner | null>(null);

export function useOutliner(): Outliner {
  const o = useContext(OutlinerContext);
  if (!o) throw new Error("useOutliner outside <OutlinerContext>");
  return o;
}

export function useNode(id: string | null): Node | undefined {
  const { store } = useOutliner();
  const subscribe = useCallback((cb: () => void) => (id ? store.subscribeNode(id, cb) : () => {}), [store, id]);
  return useSyncExternalStore(subscribe, () => (id ? store.get(id) : undefined));
}

/** The view settings (zoom, show completed, search filter). Every change re-renders every user. */
export function useView(): View {
  const { ui } = useOutliner();
  return useSyncExternalStore(
    useCallback((cb: () => void) => ui.subscribe(cb), [ui]),
    () => ui.view,
  );
}

/** The ids of a node's children (null: top level) shown in this view, in order. */
export function useShownChildren(parentId: string | null): string[] {
  const { store } = useOutliner();
  const view = useView();
  const subscribe = useCallback((cb: () => void) => store.subscribeChildren(parentId, cb), [store, parentId]);
  const all = useSyncExternalStore(subscribe, () => store.children(parentId));
  return useMemo(() => all.filter((id) => isShown(store.get(id), view)), [all, view, store]);
}

/** The caret, if bullet id is the one being edited. */
export function useCaret(id: string): Caret | null {
  const { ui } = useOutliner();
  const subscribe = useCallback((cb: () => void) => ui.subscribeId(id, cb), [ui, id]);
  return useSyncExternalStore(subscribe, () => (ui.caret?.id === id ? ui.caret : null));
}

export function useSelected(id: string): boolean {
  const { ui } = useOutliner();
  const subscribe = useCallback((cb: () => void) => ui.subscribeId(id, cb), [ui, id]);
  return useSyncExternalStore(subscribe, () => ui.isSelected(id));
}

export function useSyncState(): SyncState {
  const { sync } = useOutliner();
  return useSyncExternalStore(
    useCallback((cb: () => void) => sync.subscribe(cb), [sync]),
    () => sync.state,
  );
}

/** Re-renders on every change to the tree: for views over all of it (search, sidebar). */
export function useTreeVersion(): number {
  const { store } = useOutliner();
  return useSyncExternalStore(
    useCallback((cb: () => void) => store.subscribe(cb), [store]),
    () => store.version,
  );
}
