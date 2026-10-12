import { ArchiveRestore, Trash2 } from "lucide-react";
import { BIN_DAYS, type Journal } from "../shared/protocol.ts";
import { JOURNAL_COLORS } from "./colors.ts";
import { savedAt } from "./format.ts";
import { dangerButton, secondaryButton } from "./ui/buttons.ts";

interface BinViewProps {
  binned: Journal[];
  onRestore: (journal: Journal) => void;
  onPurge: (journal: Journal) => void;
}

/** Journals in the recycle bin, with their pages: restored, or deleted for good. */
export function BinView({ binned, onRestore, onPurge }: BinViewProps) {
  const daysLeft = (j: Journal) =>
    Math.max(0, Math.ceil((Date.parse(j.deletedAt!) + BIN_DAYS * 86_400_000 - Date.now()) / 86_400_000));

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8">
      <h1 className="mb-2 font-serif text-2xl text-stone-900">Recycle bin</h1>
      <p className="mb-5 text-sm text-stone-500">
        A deleted journal stays here, with all its pages, for {BIN_DAYS} days. Then it is deleted for good.
      </p>
      {binned.length === 0 && <p className="text-sm text-stone-400">The recycle bin is empty.</p>}
      <ul className="space-y-2">
        {binned.map((j) => (
          <li
            key={j.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3"
          >
            <span className={`h-3 w-3 rounded-full ${JOURNAL_COLORS[j.color].dot}`} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-stone-800">{j.name}</p>
              <p className="text-xs text-stone-500">
                {j.pages === 1 ? "1 page" : `${j.pages} pages`} · deleted {savedAt(j.deletedAt!)} · {daysLeft(j)} days
                left
              </p>
            </div>
            <button type="button" className={secondaryButton} onClick={() => onRestore(j)}>
              <ArchiveRestore className="h-4 w-4" aria-hidden /> Restore
            </button>
            <button type="button" className={dangerButton} onClick={() => onPurge(j)}>
              <Trash2 className="h-4 w-4" aria-hidden /> Delete for good
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
