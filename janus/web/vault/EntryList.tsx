import { memo, useEffect, useRef } from "react";
import { KeyRound, Timer } from "lucide-react";
import type { EntrySummary } from "../../shared/protocol.ts";
import { formatDate, hostOf } from "../util.ts";

interface EntryListProps {
  entries: EntrySummary[];
  selectedId: string | null;
  /** group path per entry id, shown when the list mixes groups (all entries, search, bin) */
  paths: Map<string, string> | null;
  emptyText: string;
  inBin: boolean;
  onOpen: (id: string) => void;
}

// Memoized, so typing in the editor doesn't redraw every entry.
export const EntryList = memo(function EntryList({
  entries,
  selectedId,
  paths,
  emptyText,
  inBin,
  onOpen,
}: EntryListProps) {
  const selectedRef = useRef<HTMLButtonElement>(null);

  // Keep the selected entry in sight when ↑/↓ moves the selection.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  if (entries.length === 0) return <p className="p-6 text-center text-sm text-gray-400">{emptyText}</p>;

  return (
    <ul>
      {entries.map((e) => {
        const selected = e.id === selectedId;
        const path = paths?.get(e.id);
        return (
          <li key={e.id}>
            <button
              type="button"
              ref={selected ? selectedRef : undefined}
              onClick={() => onOpen(e.id)}
              aria-current={selected || undefined}
              className={`w-full text-left px-4 py-3 border-b border-gray-100 flex items-start gap-3 transition-colors ${
                selected ? "bg-blue-50 shadow-[inset_2px_0_0_var(--color-blue-600)]" : "hover:bg-gray-50"
              }`}
            >
              <KeyRound className={`w-4 h-4 mt-0.5 shrink-0 ${selected ? "text-blue-700" : "text-gray-300"}`} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="font-medium text-sm text-gray-800 truncate">{e.title || "Untitled"}</span>
                  {e.hasTotp && <Timer className="w-3.5 h-3.5 shrink-0 text-gray-400" aria-label="Has TOTP" />}
                </span>
                <span className="block text-xs text-gray-500 truncate">
                  {[e.username, e.url && hostOf(e.url)].filter(Boolean).join(" · ") || " "}
                </span>
                {(path || inBin) && (
                  <span className="block text-xs text-gray-400 truncate">
                    {inBin && e.deletedAt ? `Deleted ${formatDate(e.deletedAt)}` : path}
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
});
