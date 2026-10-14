// A node's menu, by a right-click, Shift+F10, the Menu key or the phone toolbar's ⋯: what can be
// done to the node, its arrows and its links. Arrow keys move through it; Esc or a click
// elsewhere closes it.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface NodeMenuItem {
  label: string;
  icon?: ReactNode;
  /** the key that does the same, shown at the right */
  keys?: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface NodeMenuProps {
  /** where it opens, in the map box's px */
  x: number;
  y: number;
  label: string;
  items: (NodeMenuItem | "-")[];
  onClose: () => void;
}

export function NodeMenu({ x, y, label, items, onClose }: NodeMenuProps) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Keep it inside the map's box.
  useLayoutEffect(() => {
    const el = box.current!;
    const parent = el.offsetParent as HTMLElement | null;
    const w = parent?.clientWidth ?? window.innerWidth;
    const h = parent?.clientHeight ?? window.innerHeight;
    setPos({
      left: Math.max(8, Math.min(x, w - el.offsetWidth - 8)),
      top: Math.max(8, Math.min(y, h - el.offsetHeight - 8)),
    });
    el.querySelector<HTMLElement>("[role=menuitem]:not(:disabled)")?.focus({ preventScroll: true });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [onClose]);

  return (
    <div
      ref={box}
      role="menu"
      aria-label={label}
      style={{ left: pos.left, top: pos.top }}
      className="absolute z-30 max-h-[70vh] w-64 overflow-y-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        const all = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]:not(:disabled)")];
        const at = all.indexOf(document.activeElement as HTMLElement);
        if (e.key === "Escape" || e.key === "Tab") {
          e.preventDefault();
          onClose();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const step = e.key === "ArrowDown" ? 1 : -1;
          all[(at + step + all.length) % all.length]?.focus();
        } else if (e.key === "Home" || e.key === "End") {
          e.preventDefault();
          (e.key === "Home" ? all[0] : all.at(-1))?.focus();
        }
      }}
    >
      {items.map((item, i) =>
        item === "-" ? (
          <div key={`-${i}`} role="separator" className="my-1 border-t border-stone-100" />
        ) : (
          <button
            key={`${item.label}-${i}`}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm focus:bg-stone-100 focus:outline-none
              disabled:text-stone-300 ${item.danger ? "text-red-700 hover:bg-red-50" : "text-stone-700 hover:bg-stone-100"}`}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-stone-400" aria-hidden>
              {item.icon}
            </span>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.keys && <kbd className="font-sans text-xs text-stone-400">{item.keys}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
