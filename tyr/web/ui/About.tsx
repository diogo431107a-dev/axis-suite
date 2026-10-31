import { useEffect, useRef, useState, type ReactNode } from "react";

/** Tyr's version and the suite's, from their package.json files when Vite builds the page. */
declare const __AXIS_VERSIONS__: { module: string; suite: string };

/** Tyr's mark as a button that opens the About box. Every module opens it from its logo at the top left. */
export function AboutButton({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (open && dialog && !dialog.open) dialog.showModal();
  }, [open]);

  return (
    <>
      <button type="button" className="mark-btn" title="About Tyr" onClick={() => setOpen(true)}>
        {children}
      </button>
      {open && (
        <dialog ref={ref} className="about" aria-label="About" onClose={() => setOpen(false)}>
          <div className="about-top">
            <img src="/favicon.svg" alt="" />
            <div>
              <p className="about-name">Tyr</p>
              <p className="about-what">A dossier of people: what was said, when, and where.</p>
            </div>
          </div>
          <dl className="about-versions">
            <dt>Version</dt>
            <dd>{__AXIS_VERSIONS__.module}</dd>
            <dt>Axis Suite</dt>
            <dd>{__AXIS_VERSIONS__.suite}</dd>
          </dl>
          {import.meta.env.DEV && <p className="about-dev">Development: these are the numbers of the last release.</p>}
          <div>
            <button type="button" className="btn ghost sm" onClick={() => ref.current?.close()}>
              Close
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}
