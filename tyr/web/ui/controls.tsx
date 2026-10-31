// The small things forms are made of: the sliding sheet and the segmented choice.
import { useEffect, useRef, type ReactNode } from "react";

interface SheetProps {
  sub: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A form slid over the page. A click outside doesn't close it, and neither does Esc once something
 * has been typed: these hold what someone just told me.
 */
export function SheetFrame({ sub, title, onClose, children }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const typed = useRef(false);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("textarea, input:not([type=hidden])")?.focus();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && !typed.current) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // onClose is a new function each render; the listener only needs the first.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div id="modal">
      <div className="scrim" />
      <div
        ref={ref}
        className="msheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="m-title"
        onInput={() => {
          typed.current = true;
        }}
      >
        <div className="m-head">
          <div>
            <p className="sub">{sub}</p>
            <h2 id="m-title">{title}</h2>
          </div>
          <button type="button" className="close-x" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

interface SegProps<T extends string> {
  label: string;
  options: readonly (readonly [T, ReactNode])[];
  value: T;
  onChange: (value: T) => void;
}

export function Seg<T extends string>({ label, options, value, onChange }: SegProps<T>) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, content]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
          {content}
        </button>
      ))}
    </div>
  );
}
