import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { SignedOutError } from "@axis-suite/heimdall-client/browser";
import type { ExportFile, RestoreResult } from "../../shared/protocol.ts";
import { api, describeError } from "../api.ts";
import { download } from "../download.ts";
import { count } from "../format.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { closeDialog } from "../ui/closeDialog.ts";
import { primaryButton, secondaryButton } from "../ui/buttons.ts";

interface BackupDialogProps {
  onRestored: () => void;
  onError: (err: unknown) => void;
  onClose: () => void;
}

/** Chronos's own backup: every calendar and event, and the settings, as one JSON file. */
export function BackupDialog({ onRestored, onError, onClose }: BackupDialogProps) {
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  /** A signed-out session goes to the page (it shows how to sign in again); the rest is shown here. */
  function failed(err: unknown) {
    if (err instanceof SignedOutError) onError(err);
    setStatus({ ok: false, text: err instanceof SignedOutError ? "Your session has ended." : describeError(err) });
  }

  async function backup() {
    setBusy(true);
    try {
      const file = await api<ExportFile>("/api/export");
      download(`chronos-${file.exportedAt.slice(0, 10)}.json`, "application/json", JSON.stringify(file, null, 2));
      const events = file.calendars.reduce((n, c) => n + c.events.length, 0);
      setStatus({
        ok: true,
        text: `Saved ${count(file.calendars.length, "calendar", "calendars")} with ${count(events, "event", "events")}.`,
      });
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  }

  async function restore(file: File) {
    setBusy(true);
    setStatus(null);
    try {
      let body: unknown;
      try {
        body = JSON.parse(await file.text());
      } catch {
        return setStatus({ ok: false, text: "That isn't a Chronos backup (.json). For .ics files, use Import .ics." });
      }
      const r = await api<RestoreResult>("/api/restore", { method: "POST", body });
      const parts = [
        r.calendars && count(r.calendars, "new calendar", "new calendars"),
        count(r.added, "event added", "events added"),
        r.updated && `${r.updated} changed`,
        r.unchanged && `${r.unchanged} already here`,
      ].filter(Boolean);
      setStatus({ ok: true, text: `Restored: ${parts.join(", ")}.` });
      onRestored();
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Backup" onClose={onClose}>
      <div className="space-y-5 text-sm">
        <section className="space-y-3">
          <p className="text-stone-500">
            Every calendar and event, and your settings, in one file. Chronos can restore it, here or for another user.
            To give a calendar to another app, export it as .ics from its menu instead.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primaryButton} disabled={busy} onClick={() => void backup()}>
              <Download className="h-4 w-4" aria-hidden /> Download backup
            </button>
            <label className={`${secondaryButton} cursor-pointer`}>
              <Upload className="h-4 w-4" aria-hidden /> Restore a backup…
              <input
                type="file"
                accept=".json,application/json"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void restore(file);
                }}
              />
            </label>
          </div>
          <p className="text-xs text-stone-400">
            Restoring adds to what is here: calendars match by name, events by their UID, and restoring the same file
            twice changes nothing.
          </p>
        </section>
        {status && (
          <p role="status" className={status.ok ? "text-emerald-700" : "text-red-700"}>
            {status.text}
          </p>
        )}
        <div className="flex justify-end">
          <button type="button" className={secondaryButton} onClick={(e) => closeDialog(e.currentTarget)}>
            Close
          </button>
        </div>
      </div>
    </Dialog>
  );
}
