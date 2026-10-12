import { ArchiveRestore, Trash2 } from "lucide-react";
import { displayName } from "../shared/contact.ts";
import { BIN_DAYS, type ContactSummary } from "../shared/protocol.ts";
import { savedAt } from "./format.ts";
import { Avatar } from "./ui/Avatar.tsx";
import { dangerButton, secondaryButton } from "./ui/buttons.ts";

interface BinViewProps {
  /** null while loading */
  binned: ContactSummary[] | null;
  onRestore: (contact: ContactSummary) => void;
  onPurge: (contact: ContactSummary) => void;
}

/** Contacts in the recycle bin: restored, or deleted for good. */
export function BinView({ binned, onRestore, onPurge }: BinViewProps) {
  const daysLeft = (c: ContactSummary) =>
    Math.max(0, Math.ceil((Date.parse(c.deletedAt!) + BIN_DAYS * 86_400_000 - Date.now()) / 86_400_000));
  const sorted = binned?.toSorted((a, b) => b.deletedAt!.localeCompare(a.deletedAt!));

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8">
      <h1 className="mb-2 text-2xl font-semibold text-stone-900">Recycle bin</h1>
      <p className="mb-5 text-sm text-stone-500">
        A deleted contact stays here for {BIN_DAYS} days. Then it is deleted for good.
      </p>
      {sorted?.length === 0 && <p className="text-sm text-stone-400">The recycle bin is empty.</p>}
      <ul className="space-y-2">
        {sorted?.map((c) => (
          <li
            key={c.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3"
          >
            <Avatar contact={c} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-stone-800">{displayName(c)}</p>
              <p className="text-xs text-stone-500">
                Deleted {savedAt(c.deletedAt!)} · {daysLeft(c)} days left
              </p>
            </div>
            <button type="button" className={secondaryButton} onClick={() => onRestore(c)}>
              <ArchiveRestore className="h-4 w-4" aria-hidden /> Restore
            </button>
            <button type="button" className={dangerButton} onClick={() => onPurge(c)}>
              <Trash2 className="h-4 w-4" aria-hidden /> Delete for good
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
