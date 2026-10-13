import { useMemo, useState } from "react";
import type { Calendar, Settings } from "../../shared/protocol.ts";
import { isZone } from "../../shared/zones.ts";
import { offsetText } from "../format.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { closeDialog } from "../ui/closeDialog.ts";
import { label, primaryButton, secondaryButton, textInput } from "../ui/buttons.ts";

interface SettingsDialogProps {
  settings: Settings;
  calendars: Calendar[];
  /** true when it worked (the dialog then closes) */
  onSave: (settings: Settings) => Promise<boolean>;
  onClose: () => void;
}

const DURATIONS = [15, 30, 45, 60, 90, 120, 180];

/** The home zone every time is shown in, where new events go, and how long they last. */
export function SettingsDialog({ settings, calendars, onSave, onClose }: SettingsDialogProps) {
  const [zone, setZone] = useState(settings.homeZone);
  const [calendarId, setCalendarId] = useState(settings.defaultCalendarId ?? "");
  const [duration, setDuration] = useState(settings.defaultDuration);
  const [busy, setBusy] = useState(false);
  const zones = useMemo(() => Intl.supportedValuesOf("timeZone"), []);
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const valid = isZone(zone) && !zone.startsWith("UTC+") && !zone.startsWith("UTC-");

  return (
    <Dialog title="Settings" onClose={onClose}>
      <form
        className="space-y-5 text-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          setBusy(true);
          const saved = await onSave({
            homeZone: zone,
            defaultCalendarId: calendarId || null,
            defaultDuration: duration,
          });
          setBusy(false);
          if (saved) closeDialog(form);
        }}
      >
        <div>
          <label htmlFor="settings-zone" className={label}>
            Home time zone
          </label>
          <input
            id="settings-zone"
            data-autofocus
            list="settings-zones"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            className={`${textInput} ${valid ? "" : "border-red-300"}`}
          />
          <datalist id="settings-zones">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
          <p className="mt-1 text-xs text-stone-500">
            {valid ? `Now ${offsetText(zone)}. ` : "Not a time zone. "}
            Every time is shown on this zone&apos;s clock. Changing it moves timed events on the screen, not in time;
            all-day events stay on their days.
            {browserZone !== zone && (
              <>
                {" "}
                <button type="button" className="text-indigo-700 hover:underline" onClick={() => setZone(browserZone)}>
                  Use this device&apos;s ({browserZone})
                </button>
              </>
            )}
          </p>
          <p className="mt-1 text-xs text-stone-400">
            Times in files that name no zone were read in the home zone of the day they were imported.
          </p>
        </div>

        <div>
          <label htmlFor="settings-calendar" className={label}>
            New events go into
          </label>
          <select
            id="settings-calendar"
            value={calendarId}
            onChange={(e) => setCalendarId(e.target.value)}
            className={textInput}
          >
            <option value="">The first calendar</option>
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="settings-duration" className={label}>
            New events last
          </label>
          <select
            id="settings-duration"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className={textInput}
          >
            {DURATIONS.map((m) => (
              <option key={m} value={m}>
                {m < 60
                  ? `${m} minutes`
                  : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")} h`}
              </option>
            ))}
          </select>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={secondaryButton} onClick={(e) => closeDialog(e.currentTarget)}>
            Cancel
          </button>
          <button type="submit" className={primaryButton} disabled={busy || !valid}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}
