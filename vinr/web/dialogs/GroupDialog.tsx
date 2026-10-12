import { useState } from "react";
import { Trash2 } from "lucide-react";
import { COLORS, LIMITS, type Color, type Group, type GroupFields } from "../../shared/protocol.ts";
import { GROUP_COLORS } from "../colors.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { closeDialog } from "../ui/closeDialog.ts";
import { dangerButton, label, primaryButton, secondaryButton, textInput } from "../ui/buttons.ts";

interface GroupDialogProps {
  /** the group to change; none to make a new one */
  group?: Group;
  /** the colour a new group starts with */
  suggestedColor?: Color;
  /** true when it worked (the dialog then closes) */
  onSave: (fields: GroupFields) => Promise<boolean>;
  onDelete?: () => Promise<boolean>;
  onClose: () => void;
}

/** Makes a group, or renames, recolours or deletes one. */
export function GroupDialog({ group, suggestedColor, onSave, onDelete, onClose }: GroupDialogProps) {
  const [name, setName] = useState(group?.name ?? "");
  const [color, setColor] = useState<Color>(group?.color ?? suggestedColor ?? COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <Dialog title={group ? "Group" : "New group"} onClose={onClose}>
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
          <label htmlFor="group-name" className={label}>
            Name
          </label>
          <input
            id="group-name"
            data-autofocus
            required
            maxLength={LIMITS.groupNameChars}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Family, Work, Clients…"
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
                className={`h-7 w-7 rounded-full ${GROUP_COLORS[c].dot} ${
                  c === color ? "ring-2 ring-stone-800 ring-offset-2" : "opacity-70 hover:opacity-100"
                }`}
              />
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-2 pt-2">
          {group && onDelete && !confirmDelete && (
            <button type="button" className={dangerButton} onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" aria-hidden /> Delete…
            </button>
          )}
          <span className="flex-1" />
          <button type="button" className={secondaryButton} onClick={(e) => closeDialog(e.currentTarget)}>
            Cancel
          </button>
          <button type="submit" className={primaryButton} disabled={busy || !name.trim()}>
            {group ? "Save" : "Create"}
          </button>
        </div>

        {group && onDelete && confirmDelete && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <p>
              Delete the group <strong>{group.name}</strong>? Its{" "}
              {group.members === 1 ? "contact stays" : `${group.members} contacts stay`}, just outside the group.
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
                Delete the group
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
