// The outline's rows, drawn only near the window: whatever the size of the tree, about a hundred
// rows are mounted. Each row's height is measured once it is drawn (until then it is assumed to
// be one line), and spacers above and below stand in for the rows that aren't drawn.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Row } from "../model/rows.ts";
import { Bullet } from "./Bullet.tsx";
import { useOutliner } from "./hooks.ts";

/** The height of a one-line bullet, used until a row is measured. */
const ESTIMATE = 24;
/** Rows are drawn this far above and below the window, so scrolling and arrow keys find them ready. */
const OVERSCAN = 800;
/** The sticky header covers this much of the window's top. */
const HEADER = 48;

/** The index of the row that contains y (offsets[i] <= y < offsets[i + 1]), clamped to the rows. */
function rowAt(offsets: Float64Array, y: number): number {
  let lo = 0;
  let hi = offsets.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid]! <= y) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

export function VirtualRows({ rows }: { rows: Row[] }) {
  const o = useOutliner();
  const list = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, number>());
  const [measured, setMeasured] = useState(0);
  const [win, setWin] = useState({ start: 0, end: 60 });

  // Where each row starts, and the total height at the end.
  const offsets = useMemo(() => {
    const out = new Float64Array(rows.length + 1);
    for (let i = 0; i < rows.length; i++) out[i + 1] = out[i]! + (heights.current.get(rows[i]!.id) ?? ESTIMATE);
    return out;
    // measured is what changes when heights.current does.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, measured]);
  const index = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows]);
  const latest = useRef({ offsets, index });
  latest.current = { offsets, index };

  /** The rows to draw for the current scroll position. */
  const update = useCallback(() => {
    const el = list.current;
    if (!el) return;
    const { offsets: off } = latest.current;
    const n = off.length - 1;
    const top = -el.getBoundingClientRect().top;
    const start = n === 0 ? 0 : rowAt(off, top - OVERSCAN);
    const end = n === 0 ? 0 : Math.min(n, rowAt(off, top + window.innerHeight + OVERSCAN) + 1);
    setWin((w) => (w.start === start && w.end === end ? w : { start, end }));
  }, []);

  useLayoutEffect(update, [offsets, update]);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [update]);

  // Rows measure themselves as they are drawn, and again whenever they change size.
  const observer = useMemo(
    () =>
      new ResizeObserver((entries) => {
        let changed = false;
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const h = el.offsetHeight;
          if (h > 0 && heights.current.get(el.dataset.vid!) !== h) {
            heights.current.set(el.dataset.vid!, h);
            changed = true;
          }
        }
        if (changed) setMeasured((m) => m + 1);
      }),
    [],
  );
  useEffect(() => () => observer.disconnect(), [observer]);
  const measure = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      observer.observe(el);
      return () => observer.unobserve(el);
    },
    [observer],
  );

  // A caret or selection moved to a row off screen (arrow keys, undo, search): scroll to it.
  useEffect(() => {
    let last: string | number | null = null;
    return o.ui.subscribe(() => {
      const caret = o.ui.caret;
      const target = caret?.id ?? o.ui.selection?.head ?? null;
      const key = caret ? caret.seq : (o.ui.selection?.head ?? null);
      if (target === null || key === last) return;
      last = key;
      const { offsets: off, index: idx } = latest.current;
      const i = idx.get(target);
      const el = list.current;
      if (i === undefined || !el) return;
      const listTop = el.getBoundingClientRect().top + window.scrollY;
      const top = listTop + off[i]!;
      const bottom = listTop + off[i + 1]!;
      if (top < window.scrollY + HEADER) window.scrollTo({ top: top - HEADER - 8 });
      else if (bottom > window.scrollY + window.innerHeight) window.scrollTo({ top: bottom - window.innerHeight + 8 });
    });
  }, [o]);

  // The bullet being edited stays mounted even when scrolled far away, so typing keeps working.
  const caretId = useSyncExternalStore(
    useCallback((cb: () => void) => o.ui.subscribe(cb), [o]),
    () => o.ui.caret?.id ?? null,
  );

  // A row moved in the page (Ctrl+Shift+Up, say) can lose focus on the way: give it back.
  useLayoutEffect(() => {
    const c = o.ui.caret;
    const active = document.activeElement;
    if (!c || (active && active !== document.body)) return;
    document.querySelector<HTMLTextAreaElement>(`[data-editor="${CSS.escape(c.id)}"]`)?.focus({ preventScroll: true });
  });

  const start = Math.min(win.start, rows.length);
  const end = Math.min(win.end, rows.length);
  const caretIndex = caretId === null ? undefined : index.get(caretId);
  const pinned = caretIndex !== undefined && (caretIndex < start || caretIndex >= end) ? rows[caretIndex]! : null;

  return (
    <div ref={list} className="relative">
      <div style={{ height: offsets[start] }} />
      {rows.slice(start, end).map((r) => (
        <div key={r.id} data-vid={r.id} ref={measure}>
          <Bullet id={r.id} depth={r.depth} />
        </div>
      ))}
      <div style={{ height: offsets[rows.length]! - offsets[end]! }} />
      {pinned && (
        <div className="absolute inset-x-0" style={{ top: offsets[caretIndex!] }}>
          <Bullet id={pinned.id} depth={pinned.depth} />
        </div>
      )}
    </div>
  );
}
