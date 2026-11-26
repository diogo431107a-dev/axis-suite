// Move to… (Alt+Shift+M, or the bullet menu): type part of a bullet's name and pick it; the
// bullets being moved go first inside it, with everything under them. ↑/↓ choose, Enter moves,
// Esc gives the caret back where it was.
import { useEffect, useMemo, useRef, useState } from "react";
import { House, X } from "lucide-react";
import type { Focus } from "../model/undo.ts";
import { moveTargets, type Destination } from "../search/destinations.ts";
import { useOutliner, useView } from "./hooks.ts";
import { moveBullets, shortName } from "./move.ts";

interface Props {
  ids: string[];
  before: Focus;
  onClose: () => void;
}

export function MoveDialog({ ids, before, onClose }: Props) {
  const o = useOutliner();
  const { showCompleted } = useView();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const list = useMemo(() => moveTargets(o.store, ids, query, showCompleted), [o, ids, query, showCompleted]);
  const title = ids.length === 1 ? `Move “${shortName(o, ids[0]!)}” to…` : `Move ${ids.length} bullets to…`;

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const cancel = () => {
    onClose();
    o.restore(before);
  };
  const choose = (d: Destination | undefined) => {
    if (!d) return;
    onClose();
    if (!moveBullets(o, ids, d.id, before)) o.restore(before);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 p-4 pt-[15vh]" onMouseDown={cancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[70vh] w-full max-w-md flex-col gap-3 rounded-lg bg-white p-5 shadow-xl"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id="move-title" className="truncate text-lg font-semibold text-gray-900">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={cancel}
            className="rounded p-1 text-gray-400 hover:text-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <input
          autoFocus
          type="search"
          value={query}
          placeholder="Type part of a bullet’s name"
          aria-label="Where to move"
          aria-controls="move-list"
          aria-activedescendant={list[index] ? `move-${index}` : undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              setIndex((i) => (list.length === 0 ? 0 : (i + step + list.length) % list.length));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(list[index]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          className="rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-green-600"
        />
        {list.length === 0 ? (
          <p className="px-1 text-sm text-gray-400">No bullet you can move to matches.</p>
        ) : (
          <ul id="move-list" ref={listRef} role="listbox" className="-mx-1 min-h-0 overflow-y-auto">
            {list.map((d, i) => (
              <li
                key={d.id ?? ""}
                id={`move-${i}`}
                data-index={i}
                role="option"
                aria-selected={i === index}
                onMouseMove={() => setIndex(i)}
                onClick={() => choose(d)}
                className={`cursor-pointer rounded px-2 py-1.5 text-sm ${i === index ? "bg-green-50" : ""}`}
              >
                <div className="flex items-center gap-1.5 truncate text-gray-800">
                  {d.id === null && <House className="h-3.5 w-3.5 shrink-0 text-gray-400" />}
                  <span className="truncate">{d.name}</span>
                </div>
                {d.path.length > 0 && <div className="truncate text-xs text-gray-400">{d.path.join(" › ")}</div>}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-gray-400">
          ↑ ↓ to choose, Enter to move, Esc to cancel. The bullets go first inside the one you pick, with everything
          under them.
        </p>
      </div>
    </div>
  );
}
