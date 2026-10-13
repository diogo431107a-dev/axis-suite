import { useState } from "react";
import { Download, Trash2, Upload } from "lucide-react";
import { COLORS, LIMITS, type Calendar, type CalendarFields, type Color } from "../../shared/protocol.ts";
import { CAL_COLORS } from "../colors.ts";
import { count, stamp } from "../format.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { closeDialog } from "../ui/closeDialog.ts";
import { dangerButton, label, primaryButton, secondaryButton, textInput } from "../ui/buttons.ts";

interface CalendarDialogProps {
  /** the calendar to change; none to make a new one */
  calendar?: Calendar;
  /** the colour a new calendar starts with */
  suggestedColor?: Color;
  zone: string;
  /** true when it worked (the dialog then closes) */
  onSave: (fields: CalendarFields) => Promise<boolean>;
  onDelete?: () => Promise<boolean>;
  onExport?: () => void;
  onImport?: () => void;
  onClose: () => void;
}

/** Makes a calendar, or renames, recolours, exports, re-imports or deletes one. */
export function CalendarDialog(props: CalendarDialogProps) {
  const { calendar, zone, onSave, onDelete, onExport, onImport, onClose } = props;
  const [name, setName] = useState(calendar?.name ?? "");
  const [color, setColor] = useState<Color>(calendar?.color ?? props.suggestedColor ?? COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <Dialog title={calendar ? "Calendar" : "New calendar"} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          setBusy(true);
          const saved = await onSave({ name: name.trim(), color });
          setBusy(false);
          if (saved) closeDialog(form);
        }}
      >
        <div>
          <label htmlFor="calendar-name" className={label}>
            Name
          </label>
          <input
            id="calendar-name"
            data-autofocus
            required
            maxLength={LIMITS.calendarNameChars}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Personal, Harvest, Formula 1…"
            className={textInput}
          />
        </div>

        <fieldset>
          <legend className={label}>Colour</legend>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={c}
                aria-pressed={c === color}
                className={`h-7 w-7 rounded-full ${CAL_COLORS[c].dot} ${
                  c === color ? "ring-2 ring-stone-800 ring-offset-2" : "opacity-70 hover:opacity-100"
                }`}
              />
            ))}
          </div>
        </fieldset>

        {calendar && (
          <div className="space-y-2 rounded-lg bg-stone-50 p-3 text-sm text-stone-600">
            <p>
              {count(calendar.events, "event", "events")}
              {calendar.sourceName && (
                <>
                  , last imported from <strong className="font-medium">{calendar.sourceName}</strong>
                  {calendar.importedAt && <> on {stamp(calendar.importedAt, zone)}</>}
                </>
              )}
              .
            </p>
            <div className="flex flex-wrap gap-2">
              {onImport && (
                <button type="button" className={secondaryButton} onClick={onImport}>
                  <Upload className="h-4 w-4" aria-hidden /> Import .ics into it
                </button>
              )}
              {onExport && (
                <button type="button" className={secondaryButton} onClick={onExport} disabled={calendar.events === 0}>
                  <Download className="h-4 w-4" aria-hidden /> Export .ics
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-2">
          {calendar && onDelete && !confirmDelete && (
            <button type="button" className={dangerButton} onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" aria-hidden /> Delete…
            </button>
          )}
          <span className="flex-1" />
          <button type="button" className={secondaryButton} onClick={(e) => closeDialog(e.currentTarget)}>
            Cancel
          </button>
          <button type="submit" className={primaryButton} disabled={busy || !name.trim()}>
            {calendar ? "Save" : "Create"}
          </button>
        </div>

        {calendar && onDelete && confirmDelete && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <p>
              Delete the calendar <strong>{calendar.name}</strong>
              {calendar.events > 0 ? ` and its ${count(calendar.events, "event", "events")}` : ""}? This can't be
              undone.
            </p>
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
                Delete the calendar
              </button>
              <button type="button" className={secondaryButton} onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
            </div>
          </div>
        )}
      </form>
    </Dialog>
  );
}
