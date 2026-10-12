import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { LIMITS, type Template, type TemplateFields } from "../../shared/protocol.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { dangerButton, label, primaryButton, secondaryButton, textInput } from "../ui/buttons.ts";

interface TemplatesDialogProps {
  templates: Template[];
  /** id null: a new template. Resolves to the saved template, or null if it failed. */
  onSave: (id: string | null, fields: TemplateFields) => Promise<Template | null>;
  onDelete: (template: Template) => Promise<boolean>;
  onClose: () => void;
}

/** The user's templates: text an empty page can start from (a gratitude list, a daily review…). */
export function TemplatesDialog({ templates, onSave, onDelete, onClose }: TemplatesDialogProps) {
  const [selected, setSelected] = useState<string | null>(templates[0]?.id ?? null);
  const current = templates.find((t) => t.id === selected) ?? null;
  const [name, setName] = useState(current?.name ?? "");
  const [text, setText] = useState(current?.text ?? "");
  const [busy, setBusy] = useState(false);

  const pick = (t: Template | null) => {
    setSelected(t?.id ?? null);
    setName(t?.name ?? "");
    setText(t?.text ?? "");
  };
  const changed = !current || name !== current.name || text !== current.text;

  return (
    <Dialog title="Templates" onClose={onClose} wide>
      <div className="flex flex-col gap-4 sm:flex-row">
        <ul className="space-y-0.5 sm:w-44 sm:shrink-0">
          {templates.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => pick(t)}
                className={`w-full truncate rounded-md px-3 py-1.5 text-left text-sm ${
                  t.id === selected ? "bg-amber-100 font-medium text-amber-950" : "text-stone-600 hover:bg-stone-100"
                }`}
              >
                {t.name}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => pick(null)}
              className={`flex w-full items-center gap-1.5 rounded-md px-3 py-1.5 text-left text-sm ${
                selected === null ? "bg-amber-100 font-medium text-amber-950" : "text-stone-500 hover:bg-stone-100"
              }`}
            >
              <Plus className="h-4 w-4" aria-hidden /> New template
            </button>
          </li>
        </ul>

        <form
          className="min-w-0 flex-1 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const saved = await onSave(selected, { name: name.trim(), text });
            setBusy(false);
            if (saved) pick(saved);
          }}
        >
          <div>
            <label htmlFor="template-name" className={label}>
              Name
            </label>
            <input
              id="template-name"
              data-autofocus
              required
              maxLength={LIMITS.templateNameChars}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Gratitude, Daily review…"
              className={textInput}
            />
          </div>
          <div>
            <label htmlFor="template-text" className={label}>
              Text
            </label>
            <textarea
              id="template-text"
              rows={10}
              maxLength={LIMITS.templateChars}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"Three things I'm grateful for:\n1. \n2. \n3. "}
              className={`${textInput} font-serif`}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {current && (
              <button
                type="button"
                className={dangerButton}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  if (await onDelete(current)) pick(templates.find((t) => t.id !== current.id) ?? null);
                  setBusy(false);
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden /> Delete
              </button>
            )}
            <span className="flex-1" />
            {current && changed && (
              <button type="button" className={secondaryButton} onClick={() => pick(current)}>
                Undo changes
              </button>
            )}
            <button type="submit" className={primaryButton} disabled={busy || !name.trim() || !changed}>
              {current ? "Save" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}
