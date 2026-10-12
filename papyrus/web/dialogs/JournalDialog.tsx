import { useState } from "react";
import { Trash2 } from "lucide-react";
import { COLORS, LIMITS, type Color, type Journal, type JournalPatch, type Template } from "../../shared/protocol.ts";
import { JOURNAL_COLORS } from "../colors.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { closeDialog } from "../ui/closeDialog.ts";
import { dangerButton, label, primaryButton, secondaryButton, textInput } from "../ui/buttons.ts";

interface JournalDialogProps {
  /** the journal to change; none to make a new one */
  journal?: Journal;
  templates: Template[];
  /** the colour a new journal starts with */
  suggestedColor?: Color;
  /** true when it worked (the dialog then closes) */
  onSave: (fields: Required<JournalPatch>) => Promise<boolean>;
  onBin?: () => Promise<boolean>;
  onClose: () => void;
}

/** Makes a journal, or renames, recolours or deletes one. */
export function JournalDialog({ journal, templates, suggestedColor, onSave, onBin, onClose }: JournalDialogProps) {
  const [name, setName] = useState(journal?.name ?? "");
  const [color, setColor] = useState<Color>(journal?.color ?? suggestedColor ?? COLORS[0]);
  const [templateId, setTemplateId] = useState(journal?.templateId ?? null);
  const [busy, setBusy] = useState(false);
  const [confirmBin, setConfirmBin] = useState(false);

  return (
    <Dialog title={journal ? "Journal" : "New journal"} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          setBusy(true);
          const saved = await onSave({ name: name.trim(), color, templateId });
          setBusy(false);
          if (saved) closeDialog(form);
        }}
      >
        <div>
          <label htmlFor="journal-name" className={label}>
            Name
          </label>
          <input
            id="journal-name"
            data-autofocus
            required
            maxLength={LIMITS.journalNameChars}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Personal, Work, Dreams…"
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
                className={`h-7 w-7 rounded-full ${JOURNAL_COLORS[c].dot} ${
                  c === color ? "ring-2 ring-stone-800 ring-offset-2" : "opacity-70 hover:opacity-100"
                }`}
              />
            ))}
          </div>
        </fieldset>

        {templates.length > 0 && (
          <div>
            <label htmlFor="journal-template" className={label}>
              Template offered first on an empty page
            </label>
            <select
              id="journal-template"
              value={templateId ?? ""}
              onChange={(e) => setTemplateId(e.target.value || null)}
              className={textInput}
            >
              <option value="">None</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-2">
          {journal && onBin && !confirmBin && (
            <button type="button" className={dangerButton} onClick={() => setConfirmBin(true)}>
              <Trash2 className="h-4 w-4" aria-hidden /> Delete…
            </button>
          )}
          <span className="flex-1" />
          <button type="button" className={secondaryButton} onClick={(e) => closeDialog(e.currentTarget)}>
            Cancel
          </button>
          <button type="submit" className={primaryButton} disabled={busy || !name.trim()}>
            {journal ? "Save" : "Create"}
          </button>
        </div>

        {journal && onBin && confirmBin && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <p>
              Move <strong>{journal.name}</strong> and its {journal.pages === 1 ? "page" : `${journal.pages} pages`} to
              the recycle bin? You can restore it from there for 30 days.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className={dangerButton}
                disabled={busy}
                onClick={async (e) => {
                  const button = e.currentTarget;
                  setBusy(true);
                  const done = await onBin();
                  setBusy(false);
                  if (done) closeDialog(button);
                }}
              >
                Move to the recycle bin
              </button>
              <button type="button" className={secondaryButton} onClick={() => setConfirmBin(false)}>
                Keep it
              </button>
            </div>
          </div>
        )}
      </form>
    </Dialog>
  );
}
