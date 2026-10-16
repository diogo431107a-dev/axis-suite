import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface DialogProps {
  title: string;
  /** Called when the dialog closes: its X, Esc, or a click outside it. */
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}

/**
 * A modal dialog (the browser's own <dialog>: it traps focus and closes on Esc). Opening it moves
 * the focus to its first control, so a field that should take it is marked data-autofocus
 * (React's autoFocus runs before the dialog opens, and loses the focus again).
 */
export function Dialog({ title, onClose, children, wide }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // A click on the backdrop lands on the <dialog> itself, outside its content.
      onClick={(e) => e.target === ref.current && ref.current.close()}
      className={`m-auto p-0 rounded-xl shadow-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 backdrop:bg-zinc-900/40 dark:backdrop:bg-black/60
                  w-[calc(100vw-2rem)] ${wide ? "max-w-2xl" : "max-w-md"}`}
    >
      <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-zinc-200 dark:border-zinc-800">
        <h2 className="font-semibold text-zinc-800 dark:text-zinc-100">{title}</h2>
        <button
          type="button"
          onClick={() => ref.current?.close()}
          aria-label="Close"
          className="p-1 -mr-1 rounded text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}
