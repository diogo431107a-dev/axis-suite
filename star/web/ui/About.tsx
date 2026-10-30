import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "./Dialog.tsx";

/** Star's version and the suite's, from their package.json files when Vite builds the page. */
declare const __AXIS_VERSIONS__: { module: string; suite: string };

/**
 * Star's logo and name as a button that opens the About box. Every module of the suite opens its
 * About box from its logo at the top left.
 */
export function AboutButton({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" title="About Every Man is a Star" onClick={() => setOpen(true)}>
        {children}
      </button>
      {/* Under <body>: this button is inside the page's heading, whose lettering isn't for a dialog. */}
      {open &&
        createPortal(
          <Dialog title="About" onClose={() => setOpen(false)}>
            <div className="about-top">
              <img src="/favicon.svg" alt="" />
              <div>
                <p className="about-name">Every Man is a Star</p>
                <p className="about-what">The people you know and their families, charted as a night sky.</p>
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
