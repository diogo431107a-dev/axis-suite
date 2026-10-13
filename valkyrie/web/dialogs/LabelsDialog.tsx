import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { COLORS, LIMITS, type Color, type Label } from "../../shared/protocol.ts";
import { api } from "../api.ts";
import { COLOR_CLASSES } from "../colors.ts";
import { count } from "../format.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { closeDialog } from "../ui/closeDialog.ts";
import { field, iconButton, secondaryButton } from "../ui/buttons.ts";

interface LabelsDialogProps {
  boardId: string;
  labels: Label[];
  /** how many cards have a label */
  uses: (labelId: string) => number;
  onChanged: (labels: Label[]) => void;
  onError: (err: unknown) => void;
  onClose: () => void;
}

/** The board's labels: a colour and, if wanted, a name. Each change is saved at once. */
export function LabelsDialog({ boardId, labels, uses, onChanged, onError, onClose }: LabelsDialogProps) {
  const [picking, setPicking] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function update(label: Label, change: { name?: string; color?: Color }) {
    onChanged(labels.map((l) => (l.id === label.id ? { ...l, ...change } : l)));
    try {
      await api<Label>(`/api/labels/${label.id}`, { method: "PATCH", body: change });
    } catch (err) {
      onChanged(labels);
      onError(err);
    }
  }

  async function add() {
    const used = new Set(labels.map((l) => l.color));
    const color = COLORS.find((c) => !used.has(c)) ?? COLORS[0];
    try {
      const label = await api<Label>("/api/labels", { method: "POST", body: { boardId, name: "", color } });
      onChanged([...labels, label]);
      setPicking(null);
      requestAnimationFrame(() => document.getElementById(`label-${label.id}`)?.focus());
    } catch (err) {
      onError(err);
    }
  }

  async function remove(label: Label) {
    try {
      await api(`/api/labels/${label.id}`, { method: "DELETE" });
      onChanged(labels.filter((l) => l.id !== label.id));
    } catch (err) {
      onError(err);
    }
  }

  return (
    <Dialog title="Labels" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-stone-500">A label is a colour, with a name if you want one. Cards show both.</p>
        <ul className="space-y-2">
          {labels.map((l) => (
            <li key={l.id} className="space-y-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={`Colour: ${l.color}`}
                  aria-expanded={picking === l.id}
                  onClick={() => setPicking((p) => (p === l.id ? null : l.id))}
                  className={`h-8 w-10 shrink-0 rounded-md ${COLOR_CLASSES[l.color].dot}`}
                />
                <LabelName label={l} onSave={(name) => void update(l, { name })} />
                <span className="w-16 shrink-0 text-right text-xs text-stone-400 tabular-nums">
                  {count(uses(l.id), "card", "cards")}
                </span>
                {deleting === l.id ? (
                  <button
                    type="button"
                    className="shrink-0 rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                    onClick={() => void remove(l)}
                    onBlur={() => setDeleting(null)}
                    autoFocus
                  >
                    Delete?
                  </button>
                ) : (
                  <button
                    type="button"
                    className={iconButton}
                    aria-label={`Delete the label ${l.name || l.color}`}
                    title={uses(l.id) > 0 ? "Delete (it comes off its cards)" : "Delete"}
                    onClick={() => setDeleting(l.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              {picking === l.id && (
                <div className="flex flex-wrap gap-2 pl-1">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={c}
                      aria-pressed={c === l.color}
                      onClick={() => {
                        void update(l, { color: c });
                        setPicking(null);
                      }}
                      className={`h-6 w-6 rounded-full ${COLOR_CLASSES[c].dot} ${
                        c === l.color ? "ring-2 ring-stone-800 ring-offset-2" : "opacity-70 hover:opacity-100"
                      }`}
                    />
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-2 pt-2">
          <button
            type="button"
            className={secondaryButton}
            disabled={labels.length >= LIMITS.labels}
            onClick={() => void add()}
          >
            <Plus className="h-4 w-4" aria-hidden /> Add a label
          </button>
          <button type="button" className={secondaryButton} onClick={(e) => closeDialog(e.currentTarget)}>
            Done
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function LabelName({ label, onSave }: { label: Label; onSave: (name: string) => void }) {
  const [text, setText] = useState(label.name);
  useEffect(() => setText(label.name), [label.name]);
  return (
    <input
      id={`label-${label.id}`}
      aria-label={`Name of the ${label.color} label`}
      placeholder="No name"
      value={text}
      maxLength={LIMITS.nameChars}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() !== label.name && onSave(text.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      className={`${field} min-w-0 flex-1 py-1.5`}
    />
  );
}
