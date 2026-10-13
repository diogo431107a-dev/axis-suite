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

/** Valkyrie's own backup: every board with its lists, labels, cards and checklists, as one JSON file. */
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
      download(`valkyrie-${file.exportedAt.slice(0, 10)}.json`, "application/json", JSON.stringify(file, null, 2));
      const cards = file.boards.reduce((n, b) => n + b.lists.reduce((m, l) => m + l.cards.length, 0), 0);
      setStatus({
        ok: true,
        text: `Saved ${count(file.boards.length, "board", "boards")} with ${count(cards, "card", "cards")}.`,
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
        return setStatus({ ok: false, text: "That isn't a Valkyrie backup (.json)." });
      }
      const r = await api<RestoreResult>("/api/restore", { method: "POST", body });
      setStatus({
        ok: true,
        text: `Added ${count(r.boards, "board", "boards")} with ${count(r.cards, "card", "cards")}.`,
      });
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
            Every board, with its lists, labels, cards and checklists, in one file. Valkyrie can restore it, here or for
            another user. One board alone can be exported from its settings.
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
            Restoring adds the file's boards as new boards, next to the ones here; nothing is replaced. A name already
            in use gets a number: Work (2).
          </p>
        </section>
        {status && (
          <p role="status" className={status.ok ? "text-green-700" : "text-red-700"}>
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
