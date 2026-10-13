import { useState } from "react";
import { Upload } from "lucide-react";
import { SignedOutError } from "@axis-suite/heimdall-client/browser";
import { LIMITS, type Calendar, type ImportRequest, type ImportResult } from "../../shared/protocol.ts";
import { parseIcs, spanOf, type IcsRead } from "../../shared/ics/parse.ts";
import { api, describeError } from "../api.ts";
import { count } from "../format.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { closeDialog } from "../ui/closeDialog.ts";
import { label, primaryButton, secondaryButton, textInput } from "../ui/buttons.ts";

interface ImportDialogProps {
  calendars: Calendar[];
  /** the calendar to import into, picked beforehand; none: the user chooses */
  into?: Calendar;
  zone: string;
  today: string;
  onImported: (result: ImportResult) => void;
  onError: (err: unknown) => void;
  onClose: () => void;
}

type Read = { file: string; read: IcsRead };

/** The notes an import is worth: what was unrolled, skipped or guessed. */
function notes(read: IcsRead): string[] {
  const r = read.report;
  const out: string[] = [];
  if (r.repeating) {
    out.push(
      `${count(r.repeating, "repeating event became", "repeating events became")} ${count(r.occurrences, "event", "events")}, from 2 years ago to 5 years ahead.`,
    );
  }
  if (r.truncated)
    out.push(`${count(r.truncated, "repeating event was", "repeating events were")} cut at 500 occurrences.`);
  if (r.unknownZones) {
    out.push(
      `${count(r.unknownZones, "event names a time zone", "events name time zones")} Chronos doesn't know; read with the file's offset or your home zone.`,
    );
  }
  if (r.cancelled) out.push(`${count(r.cancelled, "cancelled event", "cancelled events")} left out.`);
  if (r.unreadable) out.push(`${count(r.unreadable, "event", "events")} without a readable start left out.`);
  if (r.otherComponents)
    out.push(
      `${count(r.otherComponents, "to-do or other item", "to-dos and other items")} left out (only events are imported).`,
    );
  return out;
}

/** Imports an .ics file into a new calendar or an existing one. */
export function ImportDialog({ calendars, into, zone, today, onImported, onError, onClose }: ImportDialogProps) {
  const [read, setRead] = useState<Read | null>(null);
  const [target, setTarget] = useState<string>(into?.id ?? "new");
  const [name, setName] = useState("");
  const [removeMissing, setRemoveMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function pick(file: File) {
    setStatus(null);
    setRead(null);
    try {
      const r = parseIcs(await file.text(), { homeZone: zone, today });
      if (r.events.length === 0) return setStatus({ ok: false, text: "That file has no events in it." });
      if (r.events.length > LIMITS.importEvents) {
        return setStatus({
          ok: false,
          text: `That file has ${r.events.length} events; at most ${LIMITS.importEvents} can be imported at once.`,
        });
      }
      setRead({ file: file.name, read: r });
      setName((r.calendarName ?? file.name.replace(/\.ics$/i, "")).slice(0, LIMITS.calendarNameChars));
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : "That file can't be read." });
    }
  }

  async function run() {
    if (!read) return;
    setBusy(true);
    setStatus(null);
    const body: ImportRequest = {
      ...(target === "new" ? { newCalendar: { name: name.trim() } } : { calendarId: target }),
      sourceName: read.file,
      removeMissing: target !== "new" && removeMissing,
      events: read.read.events,
    };
    try {
      const r = await api<ImportResult>("/api/import", { method: "POST", body });
      const parts = [
        count(r.added, "event added", "events added"),
        r.updated && `${r.updated} changed`,
        r.unchanged && `${r.unchanged} already here`,
        r.removed && `${r.removed} removed`,
      ].filter(Boolean);
      setStatus({ ok: true, text: `Imported: ${parts.join(", ")}.` });
      setRead(null);
      onImported(r);
    } catch (err) {
      if (err instanceof SignedOutError) onError(err);
      setStatus({ ok: false, text: err instanceof SignedOutError ? "Your session has ended." : describeError(err) });
    } finally {
      setBusy(false);
    }
  }

  const span = read && spanOf(read.read.events, zone);
  const note = read ? notes(read.read) : [];

  return (
    <Dialog title={into ? `Import into ${into.name}` : "Import an .ics file"} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="text-stone-500">
          An iCalendar (.ics) file: exported from another calendar, or downloaded (holidays, moon phases, Formula 1…).
          Importing an updated file again into the same calendar updates its events instead of adding them twice.
        </p>

        <label className={`${secondaryButton} cursor-pointer`}>
          <Upload className="h-4 w-4" aria-hidden /> Choose a file…
          <input
            type="file"
            accept=".ics,text/calendar"
            className="sr-only"
            data-autofocus
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void pick(file);
            }}
          />
        </label>

        {read && (
          <div className="space-y-4">
            <div className="rounded-lg bg-stone-50 p-3 text-stone-700">
              <p className="font-medium">{read.file}</p>
              <p className="tabular-nums">
                {count(read.read.events.length, "event", "events")}
                {span && (span.first === span.last ? `, on ${span.first}` : `, ${span.first} – ${span.last}`)}
              </p>
              {note.map((n) => (
                <p key={n} className="mt-1 text-xs text-stone-500">
                  {n}
                </p>
              ))}
            </div>

            {!into && (
              <div>
                <label htmlFor="import-target" className={label}>
                  Into
                </label>
                <select
                  id="import-target"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className={textInput}
                >
                  <option value="new">A new calendar</option>
                  {calendars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {target === "new" ? (
              <div>
                <label htmlFor="import-name" className={label}>
                  Name of the new calendar
                </label>
                <input
                  id="import-name"
                  required
                  maxLength={LIMITS.calendarNameChars}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={textInput}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <label className="flex items-start gap-2 text-stone-700">
                  <input
                    type="checkbox"
                    checked={removeMissing}
                    onChange={(e) => setRemoveMissing(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-indigo-600"
                  />
                  <span>
                    Remove events no longer in the file
                    <span className="block text-xs text-stone-500">
                      Only imported ones; events you made in this calendar stay.
                    </span>
                  </span>
                </label>
                <p className="text-xs text-stone-500">
                  Events already imported are replaced by the file&apos;s version, changes made here included.
                </p>
              </div>
            )}
          </div>
        )}

        {status && (
          <p role="status" className={status.ok ? "text-emerald-700" : "text-red-700"}>
            {status.text}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={secondaryButton} onClick={(e) => closeDialog(e.currentTarget)}>
            {status?.ok ? "Close" : "Cancel"}
          </button>
          {read && (
            <button
              type="button"
              className={primaryButton}
              disabled={busy || (target === "new" && !name.trim())}
              onClick={() => void run()}
            >
              Import
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
