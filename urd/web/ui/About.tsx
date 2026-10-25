import { useState, type ReactNode } from "react";
import { Dialog } from "./Dialog.tsx";

/** Urd's version and the suite's, from their package.json files when Vite builds the page. */
declare const __AXIS_VERSIONS__: { module: string; suite: string };

/**
 * Urd's logo and name as a button that opens the About box. Every module of the suite opens its
 * About box from its logo at the top left.
 */
export function AboutButton({ className, children }: { className: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        title="About Urd"
        className={`${className} rounded-lg text-left hover:opacity-75`}
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      {open && (
        <Dialog title="About Urd" onClose={() => setOpen(false)}>
          <div className="flex items-center gap-3">
            <img src="/favicon.svg" alt="" className="h-10 w-10" />
            <div>
              <p className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">Urd</p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                A time tracker: one big clock, Play/Stop, and time per period.
              </p>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-zinc-500 dark:text-zinc-400">Version</dt>
            <dd className="text-zinc-800 dark:text-zinc-100 tabular-nums">{__AXIS_VERSIONS__.module}</dd>
            <dt className="text-zinc-500 dark:text-zinc-400">Axis Suite</dt>
            <dd className="text-zinc-800 dark:text-zinc-100 tabular-nums">{__AXIS_VERSIONS__.suite}</dd>
          </dl>
          {import.meta.env.DEV && (
            <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
              Development: these are the numbers of the last release.
            </p>
          )}
        </Dialog>
      )}
    </>
  );
}
