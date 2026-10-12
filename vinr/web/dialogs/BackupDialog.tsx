import { useRef, useState } from "react";
import { Contact as ContactIcon, Download, Upload } from "lucide-react";
import { SignedOutError } from "@axis-suite/heimdall-client/browser";
import type { ExportFile, Group, ImportResult } from "../../shared/protocol.ts";
import { api, describeError } from "../api.ts";
import { download, fileName } from "../download.ts";
import { count } from "../format.ts";
import { parseVcards, writeVcards } from "../io/vcard.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { primaryButton, secondaryButton } from "../ui/buttons.ts";

interface BackupDialogProps {
  /** the group being looked at, which can be exported on its own */
  group: Group | null;
  onImported: () => void;
  onError: (err: unknown) => void;
  onClose: () => void;
}

/** Exports every contact (a JSON backup, or vCard for other apps), and imports either. */
export function BackupDialog({ group, onImported, onError, onClose }: BackupDialogProps) {
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  /** A signed-out session goes to the page (it shows how to sign in again); the rest is shown here. */
  function failed(err: unknown) {
    if (err instanceof SignedOutError) onError(err);
    setStatus({ ok: false, text: err instanceof SignedOutError ? "Your session has ended." : describeError(err) });
  }

  async function exportAs(kind: "json" | "vcard" | "group") {
    setBusy(true);
    try {
      const file = await api<ExportFile>("/api/export");
      const day = file.exportedAt.slice(0, 10);
      let contacts = file.contacts;
      if (kind === "json") download(`vinr-${day}.json`, "application/json", JSON.stringify(file, null, 2));
      else if (kind === "vcard") download(`vinr-${day}.vcf`, "text/vcard", writeVcards(contacts));
      else {
        contacts = contacts.filter((c) => c.groups.includes(group!.name));
        download(fileName(group!.name, "vcf"), "text/vcard", writeVcards(contacts));
      }
      setStatus({ ok: true, text: `Exported ${count(contacts.length, "contact", "contacts")}.` });
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    setBusy(true);
    setStatus(null);
    try {
      const text = await file.text();
      let body: unknown;
      const notes: string[] = [];
      if (/^﻿?\s*BEGIN:VCARD/i.test(text)) {
        const read = parseVcards(text);
        if (read.contacts.length === 0 && read.skipped === 0) {
          return setStatus({ ok: false, text: "That file has no contacts in it." });
        }
        body = {
          format: "vinr",
          version: 1,
          exportedAt: new Date().toISOString(),
          groups: [],
          contacts: read.contacts,
        };
        if (read.skipped) notes.push(`Skipped ${count(read.skipped, "card", "cards")} without a name, phone or email.`);
        if (read.trimmed) {
          notes.push(
            `${count(read.trimmed, "card had", "cards had")} more phones, emails or addresses than Vinr keeps; the first ones were kept.`,
          );
        }
        const photos = read.ignored.get("PHOTO");
        if (photos) notes.push(`Photos aren't kept (${count(photos, "card had one", "cards had one")}).`);
      } else {
        try {
          body = JSON.parse(text);
        } catch {
          return setStatus({ ok: false, text: "That file is neither a vCard (.vcf) nor a Vinr backup (.json)." });
        }
      }
      const r = await api<ImportResult>("/api/import", { method: "POST", body });
      const parts = [
        count(r.added, "new contact", "new contacts"),
        r.merged && `${count(r.merged, "contact", "contacts")} filled in with what they lacked`,
        r.unchanged && `${count(r.unchanged, "contact", "contacts")} already here`,
        r.groups && count(r.groups, "new group", "new groups"),
      ].filter(Boolean);
      setStatus({ ok: true, text: [`Imported: ${parts.join(", ")}.`, ...notes].join(" ") });
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
            Every contact (not the recycle bin). The JSON backup holds everything, groups and settings too, and Vinr can
            import it again. vCard (.vcf) is for phones, Google Contacts, Outlook and other apps; it leaves out
            favourites and WhatsApp marks.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primaryButton} disabled={busy} onClick={() => exportAs("json")}>
              <Download className="h-4 w-4" aria-hidden /> Backup (JSON)
            </button>
            <button type="button" className={secondaryButton} disabled={busy} onClick={() => exportAs("vcard")}>
              <ContactIcon className="h-4 w-4" aria-hidden /> vCard
            </button>
            {group && (
              <button type="button" className={secondaryButton} disabled={busy} onClick={() => exportAs("group")}>
                <ContactIcon className="h-4 w-4" aria-hidden /> vCard of {group.name}
              </button>
            )}
          </div>
        </section>

        <section className="space-y-3 border-t border-stone-200 pt-5">
          <h3 className="text-sm font-semibold text-stone-800">Import</h3>
          <p className="text-sm text-stone-500">
            A vCard file from another app, or a Vinr backup. Someone already here, with the same name and a phone number
            or email in common, is filled in rather than added twice. Importing the same file twice changes nothing.
          </p>
          <button type="button" className={secondaryButton} disabled={busy} onClick={() => fileInput.current?.click()}>
            <Upload className="h-4 w-4" aria-hidden /> Choose a file…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".vcf,.vcard,text/vcard,text/x-vcard,.json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void importFile(file);
            }}
          />
        </section>

        {busy && <p className="text-sm text-stone-500">Working…</p>}
        {status && (
          <p role="status" className={`text-sm ${status.ok ? "text-green-700" : "text-red-600"}`}>
            {status.text}
          </p>
        )}
      </div>
    </Dialog>
  );
}
