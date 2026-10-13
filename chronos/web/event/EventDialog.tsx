import { useState } from "react";
import { Clock, ExternalLink, Globe, MapPin, Pencil, Trash2 } from "lucide-react";
import type { CalEvent, Calendar } from "../../shared/protocol.ts";
import { CAL_COLORS } from "../colors.ts";
import { sourceText, stamp, whenText } from "../format.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { closeDialog } from "../ui/closeDialog.ts";
import { dangerButton, primaryButton, secondaryButton } from "../ui/buttons.ts";

interface EventDialogProps {
  /** null while loading; "missing" when there is no such event */
  event: CalEvent | null | "missing";
  calendar: Calendar | undefined;
  zone: string;
  onEdit: () => void;
  /** true when it worked (the dialog then closes) */
  onDelete: () => Promise<boolean>;
  onClose: () => void;
}

/** An event: when, where, what, and the buttons to edit or delete it. */
export function EventDialog({ event, calendar, zone, onEdit, onDelete, onClose }: EventDialogProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  if (event === null || event === "missing") {
    return (
      <Dialog title="Event" onClose={onClose}>
        <p className="text-sm text-stone-500">{event === null ? "Loading…" : "This event doesn't exist (any more)."}</p>
      </Dialog>
    );
  }

  const source = sourceText(event, zone);
  const readOnly = calendar?.role === "viewer";
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`;

  return (
    <Dialog title={event.title} onClose={onClose}>
      <div className="space-y-3 text-sm text-stone-700">
        {calendar && (
          <p className="flex items-center gap-2 text-stone-500">
            <span className={`h-2.5 w-2.5 rounded-full ${CAL_COLORS[calendar.color].dot}`} aria-hidden />
            {calendar.name}
            {calendar.role !== "owner" && (
              <span className="text-xs text-stone-400">
                · {readOnly ? `read only, shared by ${calendar.owner}` : `shared by ${calendar.owner}`}
              </span>
            )}
          </p>
        )}
        <p className="flex items-start gap-2">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" aria-hidden />
          <span>
            <span className="tabular-nums">{whenText(event, zone)}</span>
            {!event.allDay && <span className="block text-xs text-stone-400">{zone}</span>}
            {source && <span className="block text-xs text-stone-500 tabular-nums">{source}</span>}
          </span>
        </p>
        {event.location && (
          <p className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" aria-hidden />
            <span className="min-w-0">
              <span className="break-words">{event.location}</span>{" "}
              <a
                href={maps}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-indigo-700 hover:underline"
              >
                Open in Maps
              </a>
            </span>
          </p>
        )}
        {event.url && (
          <p className="flex items-start gap-2">
            <Globe className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" aria-hidden />
            <a
              href={event.url}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 break-all text-indigo-700 hover:underline"
            >
              {event.url} <ExternalLink className="inline h-3 w-3" aria-hidden />
            </a>
          </p>
        )}
        {event.description && (
          <p className="max-h-64 overflow-y-auto rounded-lg bg-stone-50 p-3 break-words whitespace-pre-wrap">
            {event.description}
          </p>
        )}
        <p className="text-xs text-stone-400">
          {event.origin === "import"
            ? `Imported${calendar?.sourceName ? ` from ${calendar.sourceName}` : ""}; importing the file again replaces changes made here.`
            : `Made ${stamp(event.createdAt, zone)}.`}
        </p>

        {!confirmDelete ? (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            {!readOnly && (
              <button type="button" className={dangerButton} onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4" aria-hidden /> Delete…
              </button>
            )}
            <span className="flex-1" />
            <button
              type="button"
              className={secondaryButton}
              onClick={(e) => closeDialog(e.currentTarget)}
              data-autofocus={readOnly || undefined}
            >
              Close
            </button>
            {!readOnly && (
              <button type="button" className={primaryButton} onClick={onEdit} data-autofocus>
                <Pencil className="h-4 w-4" aria-hidden /> Edit
              </button>
            )}
          </div>
        ) : (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
            <p>Delete this event? This can't be undone.</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className={dangerButton}
                disabled={busy}
                onClick={async (e) => {
                  const button = e.currentTarget;
                  setBusy(true);
                  const done = await onDelete();
                  setBusy(false);
                  if (done) closeDialog(button);
                }}
              >
                Delete the event
              </button>
              <button type="button" className={secondaryButton} onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
