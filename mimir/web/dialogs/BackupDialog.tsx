import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { SignedOutError } from "@axis-suite/heimdall-client/browser";
import type { ExportFile, ExportNode, RestoreResult } from "../../shared/protocol.ts";
import { api, describeError } from "../api.ts";
import { download } from "../download.ts";
import { count } from "../format.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { closeDialog } from "../ui/closeDialog.ts";
import { primaryButton, secondaryButton } from "../ui/buttons.ts";

interface BackupDialogProps {
  onRestored: (ids: string[]) => void;
  onError: (err: unknown) => void;
  onClose: () => void;
}

/** How many nodes a backup's map holds. */
function nodesIn(root: ExportNode): number {
  let n = 0;
  const stack = [root];
  while (stack.length > 0) {
    n++;
    stack.push(...(stack.pop()!.children ?? []));
  }
  return n;
}

/** Mimir's own backup: every map with its nodes and arrows, as one JSON file. */
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
      download(`mimir-${file.exportedAt.slice(0, 10)}.json`, "application/json", JSON.stringify(file, null, 2));
      const nodes = file.maps.reduce((n, m) => n + nodesIn(m.root), 0);
      setStatus({
        ok: true,
        text: `Saved ${count(file.maps.length, "map", "maps")} with ${count(nodes, "node", "nodes")}.`,
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
        return setStatus({ ok: false, text: "That isn't a Mimir backup (.json)." });
      }
      const r = await api<RestoreResult>("/api/restore", { method: "POST", body });
      const dropped =
        r.droppedArrows > 0 ? ` ${count(r.droppedArrows, "arrow", "arrows")} pointed nowhere and were left out.` : "";
      setStatus({
        ok: true,
        text: `Added ${count(r.maps, "map", "maps")} with ${count(r.nodes, "node", "nodes")}.${dropped}`,
      });
      onRestored(r.ids);
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
            Every map, with all its nodes and arrows, in one file. Mimir can restore it, here or for another user. A map
            alone can be exported as OPML or as a picture from its menu.
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
            Restoring adds the file's maps as new maps, next to the ones here; nothing is replaced.
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
