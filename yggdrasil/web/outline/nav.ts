// Zooming: the zoomed-in bullet is part of the URL (/n/<id>), so Back and Forward work and a
// link to a bullet opens it. Caddy and Vite send every path to index.html.
import type { Outliner } from "../model/outliner.ts";

const PATH = /^\/n\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

export const pathOf = (id: string | null) => (id ? `/n/${id}` : "/");

/** The bullet the address bar points at, or null for the whole tree. */
export function zoomFromLocation(): string | null {
  return PATH.exec(location.pathname)?.[1]?.toLowerCase() ?? null;
}

/** Zooms into bullet id (null: the whole tree), adding a browser history entry. */
export function zoomTo(o: Outliner, id: string | null): void {
  o.ui.clearSelection();
  o.ui.setView({ zoom: id });
  if (location.pathname !== pathOf(id)) history.pushState(null, "", pathOf(id));
  window.scrollTo({ top: 0 });
}

/** Puts the cursor in the search box (Ctrl+F). */
export function focusSearch(): void {
  const input = document.querySelector<HTMLInputElement>("[data-search]");
  input?.focus();
  input?.select();
}
