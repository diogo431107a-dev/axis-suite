// Panning and zooming: which part of the map the window shows. A point of the map at (x, y) is
// drawn at (x·k + tx, y·k + ty) in the map's box. Moving the view never re-renders React: the
// map's <g> and the editor are moved directly, once per frame.
import type { Box } from "../layout/layout.ts";

export const MAX_ZOOM = 3;
const MIN_ZOOM = 0.2;

export interface ViewState {
  tx: number;
  ty: number;
  k: number;
}

export class View {
  tx = 0;
  ty = 0;
  k = 1;
  /** the zoom that fits the whole map: zooming out stops a little below it */
  #fitK = 1;
  #frame = 0;
  #listeners = new Set<() => void>();
  /** Elements that move with the map: transformed (in px) as the map is. */
  #layers = new Map<Element, (s: ViewState) => void>();
  readonly #container: () => HTMLElement | null;

  constructor(container: () => HTMLElement | null) {
    this.#container = container;
  }

  get minZoom(): number {
    return Math.min(MIN_ZOOM, this.#fitK * 0.9);
  }

  /** The size of the map's box on screen. */
  size(): { w: number; h: number } {
    const el = this.#container();
    return { w: el?.clientWidth ?? 800, h: el?.clientHeight ?? 600 };
  }

  /** A point of the page (clientX/Y) in map coordinates. */
  toMap(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.#container()?.getBoundingClientRect() ?? { left: 0, top: 0 };
    return { x: (clientX - rect.left - this.tx) / this.k, y: (clientY - rect.top - this.ty) / this.k };
  }

  /** A map point on screen, in the map box's px. */
  toScreen(x: number, y: number): { x: number; y: number } {
    return { x: x * this.k + this.tx, y: y * this.k + this.ty };
  }

  /** Adds an element moved with the map; `apply` sets its transform. Returns how to remove it. */
  attach(el: Element, apply: (s: ViewState) => void): () => void {
    this.#layers.set(el, apply);
    apply(this);
    return () => this.#layers.delete(el);
  }

  /** Called (at most once per frame) after the view moved. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  set(tx: number, ty: number, k: number): void {
    this.k = Math.min(MAX_ZOOM, Math.max(this.minZoom, k));
    this.tx = tx;
    this.ty = ty;
    if (!this.#frame) this.#frame = requestAnimationFrame(() => this.#apply());
  }

  panBy(dx: number, dy: number): void {
    this.set(this.tx + dx, this.ty + dy, this.k);
  }

  /** Zooms by `factor` keeping the map point under (sx, sy) (map box px) where it is. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const k = Math.min(MAX_ZOOM, Math.max(this.minZoom, this.k * factor));
    const x = (sx - this.tx) / this.k;
    const y = (sy - this.ty) / this.k;
    this.set(sx - x * k, sy - y * k, k);
  }

  /** Zooms about the middle of the window. */
  zoomBy(factor: number): void {
    const { w, h } = this.size();
    this.zoomAt(factor, w / 2, h / 2);
  }

  /** Puts map point (x, y) in the middle of the window, at zoom k. */
  centreOn(x: number, y: number, k = this.k): void {
    const { w, h } = this.size();
    const z = Math.min(MAX_ZOOM, Math.max(this.minZoom, k));
    this.set(w / 2 - x * z, h / 2 - y * z, z);
  }

  /** The map point in the middle of the window. */
  centre(): { x: number; y: number } {
    const { w, h } = this.size();
    return { x: (w / 2 - this.tx) / this.k, y: (h / 2 - this.ty) / this.k };
  }

  /** Remembers how big the map is, for the zoom limit; `fit` also shows all of it. */
  setBounds(bounds: { x: number; y: number; w: number; h: number }, fit = false): void {
    const { w, h } = this.size();
    const pad = 40;
    this.#fitK = Math.min(1, (w - 2 * pad) / Math.max(1, bounds.w), (h - 2 * pad) / Math.max(1, bounds.h));
    if (fit) this.centreOn(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2, this.#fitK);
  }

  /** Pans as little as needed so a box is fully in view (with a margin), if it fits. */
  reveal(box: Pick<Box, "x" | "y" | "w" | "h">, margin = 48): void {
    const { w, h } = this.size();
    const left = box.x * this.k + this.tx;
    const top = box.y * this.k + this.ty;
    const right = left + box.w * this.k;
    const bottom = top + box.h * this.k;
    let dx = 0;
    let dy = 0;
    if (right > w - margin) dx = w - margin - right;
    if (left + dx < margin) dx = margin - left;
    if (bottom > h - margin) dy = h - margin - bottom;
    if (top + dy < margin) dy = margin - top;
    if (dx || dy) this.panBy(dx, dy);
  }

  #apply(): void {
    this.#frame = 0;
    for (const apply of this.#layers.values()) apply(this);
    for (const l of this.#listeners) l();
  }

  dispose(): void {
    cancelAnimationFrame(this.#frame);
    this.#layers.clear();
    this.#listeners.clear();
  }
}

const viewKey = (user: string, mapId: string) => `mimir.view.${user}.${mapId}`;

/** What a map looked like when it was left: the point in the middle, the zoom and the selection. */
export interface SavedView {
  x: number;
  y: number;
  k: number;
  selected: string | null;
}

export function loadView(user: string, mapId: string): SavedView | null {
  try {
    const v = JSON.parse(localStorage.getItem(viewKey(user, mapId)) ?? "null") as SavedView | null;
    return v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.k) ? v : null;
  } catch {
    return null;
  }
}

export function saveView(user: string, mapId: string, view: SavedView): void {
  try {
    localStorage.setItem(viewKey(user, mapId), JSON.stringify(view));
  } catch {
    // Not remembered: the map opens fitted next time.
  }
}

export function forgetView(user: string, mapId: string): void {
  try {
    localStorage.removeItem(viewKey(user, mapId));
  } catch {
    // Nothing to forget.
  }
}
