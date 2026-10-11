// The search box (Ctrl+F). It searches inside the zoomed-in bullet as you type; Enter or Down
// goes to the first match, Esc closes the search.
import { useCallback, useSyncExternalStore } from "react";
import { Search, X } from "lucide-react";
import * as cmd from "../model/commands.ts";
import { useOutliner, useView } from "./hooks.ts";

export function SearchBox() {
  const o = useOutliner();
  const query = useSyncExternalStore(
    useCallback((cb: () => void) => o.subscribeQuery(cb), [o]),
    () => o.query,
  );
  const { matches } = useView();

  const firstMatch = () => {
    const { matches: found, zoom } = o.ui.view;
    if (!found) return;
    const ctx = o.ctx();
    for (let id = zoom === null ? (ctx.shown(null)[0] ?? null) : cmd.below(ctx, zoom); id; id = cmd.below(ctx, id)) {
      if (found.has(id)) {
        o.ui.setCaret(id, o.store.get(id)!.content.length);
        return;
      }
    }
  };

  return (
    <div className="relative flex w-full max-w-sm items-center">
      <Search className="pointer-events-none absolute left-2.5 h-4 w-4 text-gray-400" />
      <input
        data-search
        type="search"
        value={query}
        placeholder="Search  (Ctrl+F)"
        aria-label="Search"
        spellCheck={false}
        onChange={(e) => o.setQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            o.setQuery("");
            e.currentTarget.blur();
          } else if (e.key === "Enter" || e.key === "ArrowDown") {
            e.preventDefault();
            firstMatch();
          }
        }}
        className="w-full rounded-md border border-gray-200 bg-gray-50 py-1 pl-8 pr-16 text-sm text-gray-700
                   placeholder-gray-400 focus:border-green-600 focus:bg-white focus:outline-none
                   [&::-webkit-search-cancel-button]:hidden"
      />
      {query && (
        <>
          <span className="pointer-events-none absolute right-7 text-xs tabular-nums text-gray-400">
            {matches?.size ?? 0}
          </span>
          <button
            type="button"
            aria-label="Close the search"
            onClick={() => o.setQuery("")}
            className="absolute right-1.5 rounded p-0.5 text-gray-400 hover:text-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );
}
