import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface DialogProps {
  title: string;
  /** Called when the dialog closes: its X, Esc, or a click outside it. */
  onClose: () => void;
  children: ReactNode;
}

/** A modal dialog (the browser's own <dialog>: it traps focus and closes on Esc). */
export function Dialog({ title, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // A click on the backdrop lands on the <dialog> itself, outside its content.
      onClick={(e) => e.target === ref.current && ref.current.close()}
    >
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
