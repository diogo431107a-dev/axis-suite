import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface DialogProps {
  title: string;
  /** Called when the dialog closes: its X or Esc. */
  onClose: () => void;
  children: ReactNode;
}

/**
 * A modal dialog (the browser's own <dialog>: it traps focus and closes on Esc). Unlike the suite's
 * other dialogs a click outside doesn't close it, because most of these hold a half-typed entry.
 */
export function Dialog({ title, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    // The browser would pick the X, the first thing it can focus. Typing starts in the first field.
    dialog.querySelector<HTMLElement>(".d-body input, .d-body select")?.focus();
  }, []);

  return (
    <dialog ref={ref} onClose={onClose}>
      <div className="d-head">
        <h2>{title}</h2>
        <button type="button" className="icon-btn" onClick={() => ref.current?.close()} aria-label="Close">
          <X aria-hidden />
        </button>
      </div>
      <div className="d-body">{children}</div>
    </dialog>
  );
}
