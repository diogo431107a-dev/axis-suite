// Drag and drop with pointer events on a bullet's dot (no HTML5 drag and drop). A line shows
// where the bullets will land; its depth follows the pointer's x. A click without dragging zooms
// into the bullet instead.
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Node } from "../../shared/protocol.ts";
import * as cmd from "../model/commands.ts";
import type { Outliner } from "../model/outliner.ts";
import { INDENT } from "./layout.ts";
import { zoomTo } from "./nav.ts";

/** Pixels to move before a press becomes a drag. */
const DRAG_THRESHOLD = 5;
/** Scroll when the pointer is this close to the top or bottom of the window. */
const SCROLL_EDGE = 60;

interface Drop {
  parentId: string | null;
  afterId: string | null;
  /** Where the line starts and sits. */
  x: number;
  y: number;
}

const dotLeft = (row: HTMLElement) => row.querySelector("[data-dot]")!.getBoundingClientRect().left;

/** The best place to drop at (x, y), or null if there is none. */
function findDrop(o: Outliner, dragged: ReadonlySet<string>, x: number, y: number): Drop | null {
  const ctx = o.ctx();
  const inDragged = (id: string) => [...dragged].some((d) => cmd.isAncestorOrSelf(ctx, d, id));
  // In the order shown (the bullet being edited may be drawn apart from the others, at its place).
  const rows = [...document.querySelectorAll<HTMLElement>("[data-row]")]
    .filter((r) => !inDragged(r.dataset.row!))
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  if (rows.length === 0) return null;

  // The gap the pointer is in: between the last row whose middle is above it and the next one.
  let lower = rows.findIndex((r) => {
    const rect = r.getBoundingClientRect();
    return y < rect.top + rect.height / 2;
  });
  if (lower < 0) lower = rows.length;
  const upperRow = rows[lower - 1];
  const lowerRow = rows[lower];

  const candidates: Drop[] = [];
  if (!upperRow) {
    candidates.push({
      parentId: ctx.root,
      afterId: null,
      x: dotLeft(lowerRow!),
      y: lowerRow!.getBoundingClientRect().top,
    });
  } else {
    const upper = upperRow.dataset.row!;
    const left = dotLeft(upperRow);
    const gapY = upperRow.getBoundingClientRect().bottom;
    const shownKids = ctx.expanded(upper) ? ctx.shown(upper).filter((k) => !dragged.has(k)) : [];
    candidates.push({ parentId: upper, afterId: null, x: left + INDENT, y: gapY });
    if (shownKids.length === 0) {
      // After the row's bullet, or after any ancestor whose last shown descendant it is. An
      // ancestor's row may be scrolled away (and not drawn), so its dot is found by depth.
      for (let cur: string | null = upper, up = 0; cur !== null && cur !== ctx.root; up++) {
        const node: Node = o.store.get(cur)!;
        candidates.push({ parentId: node.parentId, afterId: cur, x: left - up * INDENT, y: gapY });
        const sibs = ctx.shown(node.parentId).filter((s) => !dragged.has(s));
        if (sibs.at(-1) !== cur) break;
        cur = node.parentId;
      }
    }
  }
  // Never shallower than the row below the gap, or the drop would land after it.
  const minX = lowerRow ? dotLeft(lowerRow) - 2 : -Infinity;
  const valid = candidates.filter((c) => c.x >= minX);
  if (valid.length === 0) return null;
  return valid.reduce((best, c) => (Math.abs(c.x - x) < Math.abs(best.x - x) ? c : best));
}

export function onDotPointerDown(o: Outliner, id: string, e: ReactPointerEvent<HTMLElement>): void {
  if (e.button !== 0) return;
  e.preventDefault(); // no text selection, and the editor keeps focus until something happens
  const dot = e.currentTarget;
  const startX = e.clientX;
  const startY = e.clientY;
  // The pointer's distance from the dot's left edge, so depth is judged by the dot, not the pointer.
  const grab = startX - dot.getBoundingClientRect().left;
  const ids = o.ui.isSelected(id) && o.ui.selection ? o.ui.selection.ids : [id];
  const dragged = new Set(ids);
  let dragging = false;
  let drop: Drop | null = null;
  let line: HTMLDivElement | null = null;
  const faded: HTMLElement[] = [];
  dot.setPointerCapture(e.pointerId);

  const begin = () => {
    dragging = true;
    o.history.seal();
    line = document.body.appendChild(document.createElement("div"));
    line.className = "pointer-events-none fixed z-50 h-0.5 rounded bg-sky-500";
    document.body.classList.add("cursor-grabbing", "select-none");
    // The dragged bullets and every row under them.
    const ctx = o.ctx();
    for (const el of document.querySelectorAll<HTMLElement>("[data-bullet]")) {
      if (ids.some((d) => cmd.isAncestorOrSelf(ctx, d, el.dataset.bullet!))) {
        el.style.opacity = "0.4";
        faded.push(el);
      }
    }
  };

  const move = (ev: PointerEvent) => {
    if (!dragging) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
      begin();
    }
    if (ev.clientY < SCROLL_EDGE) window.scrollBy(0, -12);
    else if (ev.clientY > window.innerHeight - SCROLL_EDGE) window.scrollBy(0, 12);
    drop = findDrop(o, dragged, ev.clientX - grab, ev.clientY);
    if (!line) return;
    line.style.display = drop ? "block" : "none";
    if (drop) {
      const outline = document.querySelector("[data-outline]")?.getBoundingClientRect();
      line.style.left = `${drop.x}px`;
      line.style.top = `${drop.y - 1}px`;
      line.style.width = `${Math.max(40, (outline?.right ?? window.innerWidth) - drop.x)}px`;
    }
  };

  const end = (ev: PointerEvent) => {
    dot.removeEventListener("pointermove", move);
    dot.removeEventListener("pointerup", end);
    dot.removeEventListener("pointercancel", end);
    line?.remove();
    document.body.classList.remove("cursor-grabbing", "select-none");
    for (const el of faded) el.style.opacity = "";
    if (ev.type === "pointercancel") return;
    if (!dragging) {
      zoomTo(o, id);
      o.ui.clearCaret();
      return;
    }
    const target = drop;
    if (target) o.run((ctx) => cmd.moveTo(ctx, ids, target.parentId, target.afterId));
  };

  dot.addEventListener("pointermove", move);
  dot.addEventListener("pointerup", end);
  dot.addEventListener("pointercancel", end);
}
