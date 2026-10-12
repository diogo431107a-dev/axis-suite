import { useState } from "react";
import type { Settings } from "../../shared/protocol.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { closeDialog } from "../ui/closeDialog.ts";
import { field, label, primaryButton, secondaryButton } from "../ui/buttons.ts";

interface SettingsDialogProps {
  settings: Settings;
  onSave: (settings: Settings) => Promise<boolean>;
  onClose: () => void;
}

/** How the list sorts, and the country code for WhatsApp links. */
export function SettingsDialog({ settings, onSave, onClose }: SettingsDialogProps) {
  const [sortBy, setSortBy] = useState(settings.sortBy);
  const [countryCode, setCountryCode] = useState(settings.countryCode);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog title="Settings" onClose={onClose}>
      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          setBusy(true);
          const saved = await onSave({ sortBy, countryCode });
          setBusy(false);
          if (saved) closeDialog(form);
        }}
      >
        <fieldset>
          <legend className={label}>Sort and show contacts by</legend>
          <div className="space-y-1 text-sm text-stone-700">
            {(
              [
                ["first", "First name: Maria Souza"],
                ["last", "Last name: Souza, Maria"],
              ] as const
            ).map(([value, text]) => (
              <label key={value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="sort-by"
                  value={value}
                  checked={sortBy === value}
                  onChange={() => setSortBy(value)}
                  className="accent-teal-600"
                />
                {text}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="country-code" className={label}>
            Country code for phone numbers written without one
          </label>
          <div className="flex items-center gap-1">
            <span className="text-sm text-stone-500">+</span>
            <input
              id="country-code"
              data-autofocus
              inputMode="numeric"
              maxLength={4}
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value.replace(/\D/g, ""))}
              className={`${field} w-20`}
            />
          </div>
          <p className="mt-1 text-xs text-stone-500">
            WhatsApp links need it: (11) 98765-4321 becomes +{countryCode || "…"} 11 98765-4321. 55 is Brazil.
          </p>
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
