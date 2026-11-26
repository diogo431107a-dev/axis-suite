// The keyboard shortcuts, in a dialog (Ctrl+/ or the ? at the top). The same keys as the table
// in the README; keep the two in step.
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/** On a Mac, the keymap's Ctrl is ⌘ (it accepts either). */
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const CTRL = MAC ? "⌘" : "Ctrl";
const ALT = MAC ? "⌥" : "Alt";

type Keys = string[][];

/** Each row: the keys (alternatives, each a list of keys pressed together) and what they do. */
const GROUPS: { title: string; rows: [Keys | string, string][] }[] = [
  {
    title: "Writing",
    rows: [
      [[["Enter"]], "New bullet below, splitting at the caret"],
      [[["Shift", "Enter"]], "Edit the note, and back"],
      [[["Tab"], ["Shift", "Tab"]], "Indent / outdent"],
      [[["Backspace"]], "At the start: delete an empty bullet, or join it to the one above"],
      [[[CTRL, "B / I / K"]], "Bold / italic / link"],
      [[[ALT, "D"]], "Insert today’s date"],
    ],
  },
  {
    title: "Moving around",
    rows: [
      [[["↑ / ↓"]], "Previous / next bullet"],
      [[[ALT, "→ / ←"]], `Zoom in / out (also ${CTRL}+] and ${CTRL}+[)`],
      [[[CTRL, "↑ / ↓"]], "Collapse / expand"],
      [[[CTRL, "F"]], "Search"],
    ],
  },
  {
    title: "Organizing",
    rows: [
      [[[CTRL, "Shift", "↑ / ↓"]], "Move the bullet up / down"],
      [[[ALT, "Shift", "M"]], "Move to… another bullet"],
      [[[ALT, "M"]], "Duplicate, with everything under it"],
      [[[CTRL, "Enter"]], "Complete / uncomplete"],
      [[[ALT, "S"]], "Star / unstar"],
      [[["Esc"]], "Select bullets as blocks; Shift+↑ / ↓ to extend"],
    ],
  },
  {
    title: "Undo",
    rows: [
      [[[CTRL, "Z"]], "Undo"],
      [[[CTRL, "Shift", "Z"]], `Redo (also ${CTRL}+Y)`],
    ],
  },
  {
    title: "Mouse",
    rows: [
      ["Click the dot", "Zoom into the bullet"],
      ["Drag the dot", "Move the bullet, also onto a bullet in the sidebar"],
      ["Right-click the dot, or ⋯", "The bullet’s menu"],
    ],
  },
];

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-gray-200 bg-gray-50 px-1.5 py-px font-sans text-xs text-gray-700 shadow-[0_1px_0_rgb(0_0_0/0.06)]">
      {children}
    </kbd>
  );
}

function KeysCell({ keys }: { keys: Keys | string }) {
  if (typeof keys === "string") return <span className="text-xs text-gray-600">{keys}</span>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {keys.map((combo, i) => (
        <span key={i} className="flex items-center gap-0.5">
          {i > 0 && <span className="mx-0.5 text-xs text-gray-400">/</span>}
          {combo.map((k, j) => (
            <Kbd key={j}>{k}</Kbd>
          ))}
        </span>
      ))}
    </span>
  );
}

/** The browser's own <dialog>, like the About box: Esc or a click outside closes it. */
export function HelpDialog({ onClose }: { onClose: () => void }) {
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
      aria-labelledby="help-title"
      className="m-auto max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-xl rounded-xl border border-gray-200 p-0 shadow-xl backdrop:bg-gray-900/30"
    >
      <div className="sticky top-0 flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-5 py-3">
        <h2 id="help-title" className="font-semibold text-gray-800">
          Keyboard shortcuts
        </h2>
        <button
          type="button"
          onClick={() => ref.current?.close()}
          aria-label="Close"
          className="-mr-1 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-4 p-5">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">{g.title}</h3>
            <dl className="grid grid-cols-[10rem_1fr] items-center gap-x-4 gap-y-1.5 text-sm">
              {g.rows.map(([keys, what]) => (
                <div key={what} className="contents">
                  <dt>
                    <KeysCell keys={keys} />
                  </dt>
                  <dd className="text-gray-700">{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <p className="text-xs text-gray-400">{CTRL}+/ shows this list from anywhere.</p>
      </div>
    </dialog>
  );
}
