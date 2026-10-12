import { useRef, useState } from "react";
import { AlertTriangle, Download, Upload } from "lucide-react";
import { SignedOutError } from "@axis-suite/heimdall-client/browser";
import type { ExportFile, ImportResult } from "../../shared/protocol.ts";
import { api, describeError } from "../api.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { primaryButton, secondaryButton } from "../ui/buttons.ts";

interface BackupDialogProps {
  onImported: () => void;
  onError: (err: unknown) => void;
  onClose: () => void;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Exports the vault to a JSON file, and imports one. */
export function BackupDialog({ onImported, onError, onClose }: BackupDialogProps) {
  const [understood, setUnderstood] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function exportVault() {
    setBusy(true);
    try {
      const file = await api<ExportFile>("/api/export");
      const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `janus-${file.exportedAt.slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus({ ok: true, text: `Exported ${count(file.entries.length, "entry", "entries")}.` });
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  }

  /** A signed-out session goes to the page (it shows how to sign in again); the rest is shown here. */
  function failed(err: unknown) {
    if (err instanceof SignedOutError) onError(err);
    setStatus({ ok: false, text: err instanceof SignedOutError ? "Your session has ended." : describeError(err) });
  }

  async function importFile(file: File) {
    setBusy(true);
    setStatus(null);
    try {
      let body: unknown;
      try {
        body = JSON.parse(await file.text());
      } catch {
        setStatus({ ok: false, text: "That file isn't a Janus export (it isn't JSON)." });
        return;
      }
      const result = await api<ImportResult>("/api/import", { method: "POST", body });
      const added = `Added ${count(result.groups, "group", "groups")} and ${count(result.entries, "entry", "entries")}`;
      const skipped = result.skipped ? `; ${result.skipped} already in the vault were skipped` : "";
      setStatus({ ok: true, text: `${added}${skipped}.` });
      onImported();
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Export and import" onClose={onClose}>
      <div className="space-y-5">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-800">Export</h3>
          <p className="text-sm text-gray-500">
            Downloads every group and entry (not the recycle bin) as a JSON file, which Janus can import again.
          </p>
          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            The file is not encrypted: it holds every password and TOTP secret in plain text. Keep it where only you can
            read it, and delete copies you no longer need.
          </p>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
              className="accent-blue-700"
            />
            I understand; the file stays private
          </label>
          <button type="button" className={primaryButton} disabled={!understood || busy} onClick={exportVault}>
            <Download className="w-4 h-4" /> Download export
          </button>
        </section>

        <section className="space-y-3 border-t border-gray-200 pt-5">
          <h3 className="text-sm font-semibold text-gray-800">Import</h3>
          <p className="text-sm text-gray-500">
            Adds the groups and entries of a Janus export to this vault. Groups with the same names are filled rather
            than made twice, and entries that are already here are skipped.
          </p>
          <button type="button" className={secondaryButton} disabled={busy} onClick={() => fileInput.current?.click()}>
            <Upload className="w-4 h-4" /> Choose export file…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) importFile(file);
            }}
          />
        </section>

        {status && (
          <p role="status" className={`text-sm ${status.ok ? "text-green-700" : "text-red-600"}`}>
            {status.text}
          </p>
        )}
      </div>
    </Dialog>
  );
}
