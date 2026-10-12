import { useState } from "react";
import type { Settings, WeekStart } from "../../shared/protocol.ts";
import { BUILTIN_PROMPTS } from "../prompts/builtin.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { closeDialog } from "../ui/closeDialog.ts";
import { label, primaryButton, secondaryButton, textInput } from "../ui/buttons.ts";

interface SettingsDialogProps {
  settings: Settings;
  onSave: (settings: Settings) => Promise<boolean>;
  onClose: () => void;
}

const WEEK_STARTS: [string, WeekStart][] = [
  ["As usual for my language", null],
  ["Monday", 1],
  ["Sunday", 0],
  ["Saturday", 6],
];

/** Writing prompts and the first day of the week. */
export function SettingsDialog({ settings, onSave, onClose }: SettingsDialogProps) {
  const [prompts, setPrompts] = useState(settings.prompts?.join("\n") ?? "");
  const [weekStart, setWeekStart] = useState<WeekStart>(settings.weekStart);
  const [busy, setBusy] = useState(false);
  const own = prompts
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <Dialog title="Settings" onClose={onClose} wide>
      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          setBusy(true);
          const saved = await onSave({ prompts: own.length > 0 ? own : null, weekStart });
          setBusy(false);
          if (saved) closeDialog(form);
        }}
      >
        <div>
          <label htmlFor="prompts" className={label}>
            My writing prompts, one per line
          </label>
          <textarea
            id="prompts"
            data-autofocus
            rows={10}
            value={prompts}
            onChange={(e) => setPrompts(e.target.value)}
            placeholder={`Empty: Papyrus's own ${BUILTIN_PROMPTS.length} prompts, such as\n${BUILTIN_PROMPTS.slice(0, 3).join("\n")}`}
            className={`${textInput} font-serif`}
          />
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-stone-500">
            <span>
              {own.length > 0
                ? `${own.length} of your own`
                : `Empty pages offer one of Papyrus's ${BUILTIN_PROMPTS.length} prompts a day.`}
            </span>
            {own.length === 0 && (
              <button
                type="button"
                className="text-amber-800 hover:underline"
                onClick={() => setPrompts(BUILTIN_PROMPTS.join("\n"))}
              >
                Start from Papyrus's prompts
              </button>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="week-start" className={label}>
            Weeks start on
          </label>
          <select
            id="week-start"
            value={weekStart ?? ""}
            onChange={(e) => setWeekStart(e.target.value === "" ? null : (Number(e.target.value) as WeekStart))}
            className={`${textInput} sm:w-64`}
          >
            {WEEK_STARTS.map(([name, value]) => (
              <option key={name} value={value ?? ""}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" className={secondaryButton} onClick={(e) => closeDialog(e.currentTarget)}>
            Cancel
          </button>
          <button type="submit" className={primaryButton} disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}
