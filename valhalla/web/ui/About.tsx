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
        title="About Valhalla"
      >
        Valhalla
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Valhalla">
        <div className="space-y-3 text-sm">
          <p>Version {__VALHALLA_VERSION__}</p>
          <p className="text-faint">
            Companions you define, through the Claude API. You write the personality, the appearance and the behavior;
            Valhalla sends them with every message and adds no words, no checks and no warnings of its own. What the
            model says is what you get.
          </p>
          {health ? (
            <>
              <p className="text-faint">
                Everything is kept as plain files in <span className="font-mono">{health.dataDir}</span>, which you are
                free to open, edit and copy.
              </p>
              <p className="text-faint">
                {health.apiKeyInEnvironment
                  ? "An API key is set in this server's environment."
                  : "No ANTHROPIC_API_KEY in this server's environment — a profile from `ant auth login` is used instead, if there is one."}
              </p>
            </>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}
