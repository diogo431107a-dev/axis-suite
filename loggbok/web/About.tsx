import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

/** Loggbok's version and the suite's, from their package.json files when Vite builds the page. */
declare const __AXIS_VERSIONS__: { module: string; suite: string };

/**
 * Loggbok's logo and name as a button that opens the About box. Every module of the suite opens
 * its About box from its logo at the top left.
 */
export function AboutButton({ className, children }: { className: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        title="About Loggbok"
        className={`${className} rounded-lg text-left hover:opacity-75`}
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      {open && <AboutDialog onClose={() => setOpen(false)} />}
    </>
  );
}

/** The browser's own <dialog>: it traps focus, closes on Esc, and a click outside it closes it too. */
function AboutDialog({ onClose }: { onClose: () => void }) {
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
      className="m-auto w-[calc(100vw-2rem)] max-w-sm rounded-xl border border-gray-200 p-0 shadow-xl backdrop:bg-gray-900/30"
    >
      <div className="flex items-center justify-between gap-4 border-b border-gray-200 px-5 py-3">
        <h2 className="font-semibold text-gray-800">About Loggbok</h2>
        <button
          type="button"
          onClick={() => ref.current?.close()}
          aria-label="Close"
          className="-mr-1 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="p-5">
        <div className="flex items-center gap-3">
          <span className="text-3xl" aria-hidden>
            📒
          </span>
          <div>
            <p className="text-lg font-bold tracking-tight text-gray-800">Loggbok</p>
            <p className="text-sm text-gray-500">Notes, private to each signed-in user.</p>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-gray-500">Version</dt>
          <dd className="text-gray-800 tabular-nums">{__AXIS_VERSIONS__.module}</dd>
          <dt className="text-gray-500">Axis Suite</dt>
          <dd className="text-gray-800 tabular-nums">{__AXIS_VERSIONS__.suite}</dd>
        </dl>
        {import.meta.env.DEV && (
          <p className="mt-3 text-xs text-gray-400">Development: these are the numbers of the last release.</p>
        )}
      </div>
    </dialog>
  );
}
