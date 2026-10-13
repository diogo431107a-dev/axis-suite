import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface DialogProps {
  title: string;
  /** Called when the dialog closes: its X, Esc, or a click outside it. */
  onClose: () => void;
  /** Asked before Esc, the X or a click outside closes it; false keeps it open (unsaved changes). */
  canClose?: () => boolean;
  children: ReactNode;
  wide?: boolean;
}

/**
 * A modal dialog (the browser's own <dialog>: it traps focus and closes on Esc). Opening it moves
 * the focus to its first control, so a field that should take it is marked data-autofocus
 * (React's autoFocus runs before the dialog opens, and loses the focus again).
 */
export function Dialog({ title, onClose, canClose, children, wide }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
  }, []);

  const tryClose = () => {
    if (!canClose || canClose()) ref.current?.close();
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        // Esc closes only if allowed.
        e.preventDefault();
        tryClose();
      }}
      // A click on the backdrop lands on the <dialog> itself, outside its content.
      onClick={(e) => e.target === ref.current && tryClose()}
      className={`m-auto p-0 rounded-xl shadow-xl border border-gray-200 backdrop:bg-gray-900/40
                  w-[calc(100vw-2rem)] ${wide ? "max-w-2xl" : "max-w-md"}`}
    >
      <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-gray-200">
        <h2 className="min-w-0 truncate font-semibold text-gray-800">{title}</h2>
        <button
          type="button"
          onClick={tryClose}
          aria-label="Close"
          className="p-1 -mr-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}
