// The handful of shapes every view uses: a button, a field, a notice, a dialog, an icon button, a
// speech bubble and a fold.
import { useEffect, useRef, type ReactNode } from "react";

const base =
  "inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm transition-colors " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export function Button({
  children,
  onClick,
  kind = "plain",
  disabled,
  type = "button",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: "plain" | "strong" | "quiet" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
}) {
  const look = {
    strong: "bg-accent text-paper hover:opacity-90 font-medium",
    plain: "border border-rule bg-sheet hover:border-accent",
    quiet: "text-faint hover:text-ink",
    danger: "border border-rule text-warn hover:border-warn",
  }[kind];
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className={`${base} ${look}`}>
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {hint ? <span className="mb-1.5 block text-xs text-faint">{hint}</span> : null}
      {children}
    </label>
  );
}

export const inputStyle =
  "w-full rounded border border-rule bg-sheet px-2.5 py-1.5 text-sm text-ink " + "outline-none focus:border-accent";

export function Notice({ children, kind = "warn" }: { children: ReactNode; kind?: "warn" | "quiet" }) {
  if (!children) return null;
  const look = kind === "warn" ? "border-warn/40 text-warn" : "border-rule text-faint";
  return <p className={`rounded border ${look} bg-sheet px-3 py-2 text-sm`}>{children}</p>;
}

export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const box = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  return (
    <dialog
      ref={box}
      onClose={onClose}
      className="m-auto max-h-[85vh] w-[min(92vw,44rem)] overflow-auto rounded-lg border border-rule
                 bg-paper p-5 text-ink backdrop:bg-black/40"
    >
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="font-display text-lg">{title}</h2>
        <Button kind="quiet" onClick={onClose}>
          Close
        </Button>
      </div>
      {children}
    </dialog>
  );
}

export function Bubble({ mine, refused, children }: { mine: boolean; refused?: boolean; children: ReactNode }) {
  return (
    <div
      className={`rounded-lg border px-3.5 py-2.5 ${mine ? "border-rule bg-accent-soft" : "border-rule bg-sheet"} ${
        refused ? "border-warn/50" : ""
      }`}
    >
      {children}
    </div>
  );
}

export function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded p-1 text-faint hover:text-accent disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/**
 * A section that folds: its title and a one-line hint of what is inside, always shown; the rest
 * when it is open. Opening one leaves the others as they are.
 */
export function Fold({
  title,
  hint,
  open,
  children,
}: {
  title: string;
  hint?: ReactNode;
  /** Open when first shown. */
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={open} className="group rounded border border-rule bg-sheet/50">
      <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-3 select-none">
        <span className="font-display text-lg">
          <span className="mr-2 inline-block text-faint transition-transform group-open:rotate-90">›</span>
          {title}
        </span>
        {hint ? <span className="text-xs text-faint">{hint}</span> : null}
      </summary>
      <div className="space-y-4 px-4 pb-4">{children}</div>
    </details>
  );
}
