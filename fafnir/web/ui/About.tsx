import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "./Dialog.tsx";

/** Fafnir's version and the suite's, from their package.json files when Vite builds the page. */
declare const __AXIS_VERSIONS__: { module: string; suite: string };

/**
 * Fafnir's logo and name as a button that opens the About box. Every module of the suite opens its
 * About box from its logo at the top left.
 */
export function AboutButton({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" title="About Fafnir Personal Finances" onClick={() => setOpen(true)}>
        {children}
      </button>
      {/* Under <body>: this button is inside the page's heading, whose lettering isn't for a dialog. */}
      {open &&
        createPortal(
          <Dialog title="About" onClose={() => setOpen(false)}>
            <div className="about-top">
              <img src="/favicon.svg" alt="" />
              <div>
                <p className="about-name">Fafnir Personal Finances</p>
                <p className="about-what">
                  What you have, what you owe and where your money goes, in US dollars. Also known as FPF.
                </p>
              </div>
            </div>
            <dl className="about-versions">
              <dt>Version</dt>
              <dd>{__AXIS_VERSIONS__.module}</dd>
              <dt>Axis Suite</dt>
              <dd>{__AXIS_VERSIONS__.suite}</dd>
            </dl>
            {import.meta.env.DEV && (
              <p className="about-dev">Development: these are the numbers of the last release.</p>
            )}
          </Dialog>,
          document.body,
        )}
    </>
  );
}
