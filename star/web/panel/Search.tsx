import { useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import { nameOf, phraseText, searchStars } from "../sky/model.ts";
import type { SkyStore } from "../sky/store.ts";

/** "Find a star…": by name or memo, with the arrow keys and Enter. */
export function Search({ store, onPick }: { store: SkyStore; onPick: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const hits = searchStars(store.stars, query);
  const showing = open && query.trim() !== "";

  const pick = (i: number) => {
    const hit = hits[i];
    if (!hit) return;
    setQuery("");
    setOpen(false);
    onPick(hit.id);
  };

  return (
    <div className="search">
      <SearchIcon aria-hidden strokeWidth={2} />
      <input
        type="search"
        placeholder="Find a star…"
        autoComplete="off"
        aria-label="Find a person"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            pick(active);
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            if (showing) e.stopPropagation();
            setOpen(false);
          } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && hits.length > 0) {
            e.preventDefault();
            setActive((active + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length);
          }
        }}
      />
      {showing && (
        <ul className="results">
          {hits.length > 0 ? (
            hits.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={i === active ? "active" : undefined}
                  // On mouse down, before the field's blur closes the list.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(i);
                  }}
                >
                  <b>{nameOf(s)}</b>
                  <span>{phraseText(store.index, s.id)}</span>
                </button>
              </li>
            ))
          ) : (
            <li className="empty">No star by that name yet.</li>
          )}
        </ul>
      )}
    </div>
  );
}
