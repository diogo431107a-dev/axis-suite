import { useState } from "react";
import { usePage } from "../page.ts";
import { Dialog } from "./bits.tsx";

export function About() {
  const [open, setOpen] = useState(false);
  const { health } = usePage();
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-display text-xl tracking-wide text-ink hover:text-accent"
        title="About Valhalla 2"
      >
        Valhalla 2
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Valhalla 2">
        <div className="space-y-3 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
            <dt className="text-faint">Version</dt>
            <dd className="tabular-nums">{__AXIS_VERSIONS__.module}</dd>
            <dt className="text-faint">Axis Suite</dt>
            <dd className="tabular-nums">{__AXIS_VERSIONS__.suite}</dd>
          </dl>
          {import.meta.env.DEV ? (
            <p className="text-xs text-faint">Development: these are the numbers of the last release.</p>
          ) : null}
          <p className="text-faint">
            Companions you define, through the Claude API. You write the personality, the appearance and the behavior;
            Valhalla 2 sends them with every message and adds no words, no checks and no warnings of its own. What the
            model says is what you get.
          </p>
          <p className="text-faint">
            Your characters, personas and conversations are yours alone: nobody else who signs in sees them.
          </p>
          {health && !health.apiKey ? <p className="text-faint">No Claude API key is set up on the server.</p> : null}
        </div>
      </Dialog>
    </>
  );
}
