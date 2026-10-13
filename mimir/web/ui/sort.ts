// Reordering a short list by dragging its rows, with pointer events (no HTML5 drag and drop, no
// library): the maps in the sidebar. Copied from Valkyrie's board/dnd.ts, without the board's
// scrolling. A mouse press becomes a drag after a few pixels; a finger has to rest on the row for
// a moment first, so a plain swipe still scrolls the list. Esc puts it back; a press that never
// moved is a click.
import type { PointerEvent as ReactPointerEvent } from "react";

/** Pixels a mouse moves before a press becomes a drag. */
export const DRAG_THRESHOLD = 5;
/** How long a finger rests before a drag starts, and how far it may wander meanwhile. */
export const LONG_PRESS_MS = 350;
export const LONG_PRESS_SLOP = 8;

/** How many of the midpoints lie before `at`: the slot a dragged thing lands in. */
export const slotAt = (mids: readonly number[], at: number) => mids.filter((m) => m < at).length;

export interface DragHandlers {
  /** The press became a drag; `height` and `width` are the dragged element's, for the gap. */
  begin: (size: { width: number; height: number }) => void;
  /** The pointer moved. */
  over: (x: number, y: number) => void;
  /** Released: put it where the gap is. */
  drop: () => void;
  /** Esc, or the browser took the pointer away: put it back. */
  cancel: () => void;
  /** A press that never became a drag. */
  click: () => void;
}

export interface DragOptions {
  /** presses on these are left alone (default: controls and links) */
  ignore?: string;
}

/**
 * Follows a press on `e.currentTarget`: a drag of `source` (a row) or a click. Ignores other
 * buttons and presses on the controls inside.
 */
export function startDrag(
  e: ReactPointerEvent<HTMLElement>,
  source: HTMLElement,
  handlers: DragHandlers,
  options: DragOptions = {},
): void {
  const ignore = options.ignore ?? "button, input, textarea, select, a[href]";
  if (e.button !== 0 || (e.target as HTMLElement).closest(ignore)) return;
  const touch = e.pointerType === "touch";
  // A mouse press would otherwise select text; a finger's must be left alone so it can scroll.
  if (!touch) e.preventDefault();
  const startX = e.clientX;
  const startY = e.clientY;
  const box = source.getBoundingClientRect();
  const grabX = startX - box.left;
  const grabY = startY - box.top;
  let x = startX;
  let y = startY;
  let dragging = false;
  let finished = false;
  let ghost: HTMLElement | null = null;
  let timer = 0;

  const place = () => {
    if (ghost) ghost.style.transform = `translate(${x - grabX}px, ${y - grabY}px) rotate(2deg)`;
  };

  const begin = () => {
    dragging = true;
    ghost = source.cloneNode(true) as HTMLElement;
    for (const el of [ghost, ...ghost.querySelectorAll<HTMLElement>("*")]) {
      el.removeAttribute("id");
      el.removeAttribute("tabindex");
      for (const name of el.getAttributeNames()) if (name.startsWith("data-")) el.removeAttribute(name);
    }
    Object.assign(ghost.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: `${box.width}px`,
      height: `${box.height}px`,
      margin: "0",
      zIndex: "50",
      pointerEvents: "none",
      opacity: "0.95",
      boxShadow: "0 12px 28px rgb(0 0 0 / 0.25)",
    });
    ghost.setAttribute("aria-hidden", "true");
    // Inside a dialog it has to be in the dialog, or the dialog would cover it.
    (source.closest("dialog") ?? document.body).appendChild(ghost);
    place();
    document.body.classList.add("cursor-grabbing", "select-none");
    if (touch) navigator.vibrate?.(10);
    handlers.begin({ width: box.width, height: box.height });
    handlers.over(x, y);
  };

  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    x = ev.clientX;
    y = ev.clientY;
    if (!dragging) {
      const distance = Math.hypot(x - startX, y - startY);
      if (touch && distance > LONG_PRESS_SLOP) return finish(false);
      if (!touch && distance >= DRAG_THRESHOLD) begin();
      return;
    }
    place();
    handlers.over(x, y);
  };

  // While a finger drags, the page must not scroll under it.
  const holdStill = (ev: TouchEvent) => {
    if (dragging) ev.preventDefault();
  };

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    }
  };

  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    if (!dragging) {
      finish(false);
      handlers.click();
    } else finish(true);
  };

  const cancel = (ev: PointerEvent) => {
    if (ev.pointerId === e.pointerId) finish(false);
  };

  function finish(drop: boolean) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("touchmove", holdStill);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("contextmenu", noMenu, true);
    ghost?.remove();
    document.body.classList.remove("cursor-grabbing", "select-none");
    if (!dragging) return;
    if (drop) handlers.drop();
    else handlers.cancel();
  }

  // A long press would open the browser's menu on a phone.
  const noMenu = (ev: Event) => {
    if (touch) ev.preventDefault();
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("touchmove", holdStill, { passive: false });
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("contextmenu", noMenu, true);
  if (touch) timer = window.setTimeout(begin, LONG_PRESS_MS);
}

/**
 * Reordering a short vertical list (the maps in the sidebar) by dragging one of its rows: a line
 * shows where it will land. `rows` finds the list's rows, in order; `onDrop`
 * gets the row's new index among the others.
 */
export function startSort(
  e: ReactPointerEvent<HTMLElement>,
  row: HTMLElement,
  rows: () => HTMLElement[],
  onDrop: (index: number) => void,
  options: { ignore?: string; click?: () => void } = {},
): void {
  let line: HTMLDivElement | null = null;
  let index = -1;
  const others = () => rows().filter((r) => r !== row);
  startDrag(
    e,
    row,
    {
      begin() {
        row.style.opacity = "0.3";
        line = (row.closest("dialog") ?? document.body).appendChild(document.createElement("div"));
        line.className = "pointer-events-none fixed z-50 h-0.5 rounded bg-fuchsia-500";
      },
      over(_x, y) {
        const list = others();
        index = slotAt(
          list.map((r) => {
            const b = r.getBoundingClientRect();
            return b.top + b.height / 2;
          }),
          y,
        );
        const box = row.getBoundingClientRect();
        const lineY =
          list.length === 0
            ? box.top
            : index < list.length
              ? list[index]!.getBoundingClientRect().top - 2
              : list.at(-1)!.getBoundingClientRect().bottom + 1;
        Object.assign(line!.style, { left: `${box.left}px`, width: `${box.width}px`, top: `${lineY}px` });
      },
      drop() {
        row.style.opacity = "";
        line?.remove();
        if (index >= 0) onDrop(index);
      },
      cancel() {
        row.style.opacity = "";
        line?.remove();
      },
      click: options.click ?? (() => {}),
    },
    { ignore: options.ignore },
  );
}
