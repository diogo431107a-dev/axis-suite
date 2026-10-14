import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { iconButton } from "./buttons.ts";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

/** A ⋯ button with a small menu under it. A click elsewhere or Esc closes it. */
export function Menu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>("[role=menuitem]:not(:disabled)")?.focus();
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div ref={box} className="relative">
      <button
        ref={button}
        type="button"
        className={iconButton}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className="absolute top-full right-0 z-30 mt-1 w-48 rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
          onKeyDown={(e) => {
            e.stopPropagation();
            const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]:not(:disabled)")];
            const at = items.indexOf(document.activeElement as HTMLElement);
            if (e.key === "Escape") {
              e.preventDefault();
              close();
            } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              items[(at + step + items.length) % items.length]?.focus();
            }
          }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm focus:bg-stone-100 focus:outline-none
                disabled:text-stone-300 ${item.danger ? "text-red-700 hover:bg-red-50" : "text-stone-700 hover:bg-stone-100"}`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
