import { useRef, useState } from "react";
import { Download, FileText, Upload } from "lucide-react";
import { SignedOutError } from "@axis-suite/heimdall-client/browser";
import type { ExportFile, ImportResult } from "../../shared/protocol.ts";
import { api, describeError } from "../api.ts";
import { toMarkdown } from "../io/markdown.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { primaryButton, secondaryButton } from "../ui/buttons.ts";

interface BackupDialogProps {
  onImported: () => void;
  onError: (err: unknown) => void;
  onClose: () => void;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function download(name: string, type: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Exports every journal (as JSON to import again, or as Markdown to read), and imports a JSON export. */
export function BackupDialog({ onImported, onError, onClose }: BackupDialogProps) {
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function exportAs(kind: "json" | "markdown") {
    setBusy(true);
    try {
      const file = await api<ExportFile>("/api/export");
      const day = file.exportedAt.slice(0, 10);
      if (kind === "json") download(`papyrus-${day}.json`, "application/json", JSON.stringify(file, null, 2));
      else download(`papyrus-${day}.md`, "text/markdown", toMarkdown(file));
      const pages = file.journals.reduce((n, j) => n + j.pages.length, 0);
      setStatus({
        ok: true,
        text: `Exported ${count(file.journals.length, "journal", "journals")} with ${count(pages, "page", "pages")}.`,
      });
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
        setStatus({ ok: false, text: "That file isn't a Papyrus export (it isn't JSON)." });
        return;
      }
      const r = await api<ImportResult>("/api/import", { method: "POST", body });
      const parts = [
        r.journals && `${count(r.journals, "new journal", "new journals")}`,
        `${count(r.pages, "new page", "new pages")}`,
        r.merged && `${count(r.merged, "page", "pages")} added to what was already there`,
        r.skipped && `${count(r.skipped, "page", "pages")} already here, skipped`,
        r.templates && `${count(r.templates, "template", "templates")}`,
      ].filter(Boolean);
      setStatus({ ok: true, text: `Imported: ${parts.join(", ")}.` });
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
          <h3 className="text-sm font-semibold text-stone-800">Export</h3>
          <p className="text-sm text-stone-500">
            Every journal (not the recycle bin), with your templates and settings. The JSON file is a backup Papyrus can
            import again; the Markdown file is for reading or printing.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primaryButton} disabled={busy} onClick={() => exportAs("json")}>
              <Download className="h-4 w-4" aria-hidden /> Backup (JSON)
            </button>
            <button type="button" className={secondaryButton} disabled={busy} onClick={() => exportAs("markdown")}>
              <FileText className="h-4 w-4" aria-hidden /> Markdown
            </button>
          </div>
        </section>

        <section className="space-y-3 border-t border-stone-200 pt-5">
          <h3 className="text-sm font-semibold text-stone-800">Import</h3>
          <p className="text-sm text-stone-500">
            Adds a Papyrus backup to your journals. Journals with the same name are filled rather than made twice. When
            a day already has a page, a page that is already in it is skipped, and different text is added after it.
            Importing the same file twice changes nothing.
          </p>
          <button type="button" className={secondaryButton} disabled={busy} onClick={() => fileInput.current?.click()}>
            <Upload className="h-4 w-4" aria-hidden /> Choose a backup file…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void importFile(file);
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
