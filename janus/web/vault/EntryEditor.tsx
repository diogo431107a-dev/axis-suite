import { useMemo, useState } from "react";
import { AlertTriangle, Eye, EyeOff, Timer, WandSparkles, X } from "lucide-react";
import { LIMITS, type EntryFields, type Group } from "../../shared/protocol.ts";
import { parseOtpauth } from "../../shared/totp.ts";
import { Generator } from "../generator/Generator.tsx";
import { TotpSetup } from "../totp/TotpSetup.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { iconButton, label, primaryButton, secondaryButton, textInput } from "../ui/buttons.ts";
import { compareText, groupPaths } from "../util.ts";
import { isDirty, type Draft } from "./draft.ts";

interface EntryEditorProps {
  draft: Draft;
  groups: Group[];
  saving: boolean;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  /** after a conflict: save the fields changed here over the newer version */
  onSaveOver: () => void;
  /** after a conflict: drop the changes made here */
  onDiscard: () => void;
  onCopy: (value: string) => void;
}

/** The form for a new entry or a change to one. Ctrl+S saves, Esc cancels. */
export function EntryEditor({ draft, groups, saving, onChange, onSave, onCancel, ...props }: EntryEditorProps) {
  const [revealed, setRevealed] = useState(draft.id === null);
  const [dialog, setDialog] = useState<"generator" | "totp" | null>(null);

  const groupOptions = useMemo(() => {
    const paths = groupPaths(groups);
    return groups
      .map((g) => ({ id: g.id, path: (paths.get(g.id) ?? [g.name]).join(" › ") }))
      .sort((a, b) => compareText(a.path, b.path));
  }, [groups]);

  const set = (field: keyof EntryFields, value: string) =>
    onChange({ ...draft, fields: { ...draft.fields, [field]: value } });

  // What the TOTP will be after saving.
  const newTotp = typeof draft.totp === "string" ? parseOtpauth(draft.totp) : null;
  const totpSummary =
    draft.totp === null
      ? null
      : newTotp && typeof newTotp !== "string"
        ? { ...newTotp, isNew: true }
        : draft.totpInfo && { ...draft.totpInfo, isNew: false };

  return (
    <form
      className="max-w-2xl space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-gray-800">{draft.id ? "Edit entry" : "New entry"}</h2>
        <div className="flex gap-2">
          <button type="button" className={secondaryButton} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className={primaryButton} disabled={saving || (draft.id !== null && !isDirty(draft))}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {draft.conflict && (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            This entry was changed somewhere else (another tab or device) since you started editing it.
          </p>
          <div className="mt-2 flex flex-wrap gap-2 pl-6">
            <button type="button" className={secondaryButton} onClick={props.onSaveOver}>
              Save my changes over it
            </button>
            <button type="button" className={secondaryButton} onClick={props.onDiscard}>
              Discard mine, show the other version
            </button>
          </div>
          <p className="mt-2 pl-6 text-xs text-amber-700">
            Saving over it replaces only the fields you changed; the other changes are kept.
          </p>
        </div>
      )}

      <div>
        <label htmlFor="entry-title" className={label}>
          Title
        </label>
        <input
          id="entry-title"
          autoFocus
          value={draft.fields.title}
          maxLength={LIMITS.titleChars}
          onChange={(e) => set("title", e.target.value)}
          placeholder="e.g. GitHub"
          className={textInput}
        />
      </div>

      <div>
        <label htmlFor="entry-username" className={label}>
          Username
        </label>
        <input
          id="entry-username"
          value={draft.fields.username}
          maxLength={LIMITS.usernameChars}
          onChange={(e) => set("username", e.target.value)}
          autoComplete="off"
          spellCheck={false}
          className={textInput}
        />
      </div>

      <div>
        <label htmlFor="entry-password" className={label}>
          Password
        </label>
        <div className="flex gap-1">
          <input
            id="entry-password"
            type={revealed ? "text" : "password"}
            value={draft.fields.password}
            maxLength={LIMITS.passwordChars}
            onChange={(e) => set("password", e.target.value)}
            // Janus's own fields: the browser shouldn't offer to save or fill them.
            autoComplete="new-password"
            spellCheck={false}
            className={`${textInput} font-mono`}
          />
          <button
            type="button"
            className={iconButton}
            onClick={() => setRevealed((r) => !r)}
            aria-label={revealed ? "Hide password" : "Show password"}
            title={revealed ? "Hide" : "Show"}
          >
            {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
          <button
            type="button"
            className={iconButton}
            onClick={() => setDialog("generator")}
            aria-label="Generate a password"
            title="Generate a password"
          >
            <WandSparkles className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div>
        <label htmlFor="entry-url" className={label}>
          URL
        </label>
        <input
          id="entry-url"
          value={draft.fields.url}
          maxLength={LIMITS.urlChars}
          onChange={(e) => set("url", e.target.value)}
          placeholder="https://"
          autoComplete="off"
          spellCheck={false}
          className={textInput}
        />
      </div>

      <div>
        <span className={label}>TOTP</span>
        {totpSummary ? (
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
            <Timer className="w-4 h-4 text-gray-400 shrink-0" />
            <span className="flex-1 min-w-0 text-sm text-gray-700 truncate">
              {[totpSummary.issuer, totpSummary.label].filter(Boolean).join(" · ") || "TOTP"}{" "}
              <span className="text-gray-400">
                ({totpSummary.algorithm}, {totpSummary.digits} digits, {totpSummary.period} s)
              </span>
              {totpSummary.isNew && <span className="ml-1 text-xs text-blue-700">new, saved with the entry</span>}
            </span>
            <button type="button" className={secondaryButton} onClick={() => setDialog("totp")}>
              Replace
            </button>
            <button
              type="button"
              className={iconButton}
              onClick={() => onChange({ ...draft, totp: draft.totpInfo ? null : undefined })}
              aria-label="Remove TOTP"
              title="Remove TOTP"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <button type="button" className={secondaryButton} onClick={() => setDialog("totp")}>
              <Timer className="w-4 h-4" /> Set up TOTP
            </button>
            {draft.totp === null && (
              <button
                type="button"
                className="text-xs text-gray-500 underline hover:text-gray-700"
                onClick={() => onChange({ ...draft, totp: undefined })}
              >
                Keep the current TOTP after all
              </button>
            )}
          </div>
        )}
      </div>

      <div>
        <label htmlFor="entry-group" className={label}>
          Group
        </label>
        <select
          id="entry-group"
          value={draft.groupId ?? ""}
          onChange={(e) => onChange({ ...draft, groupId: e.target.value || null })}
          className={textInput}
        >
          <option value="">No group</option>
          {groupOptions.map((g) => (
            <option key={g.id} value={g.id}>
              {g.path}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="entry-notes" className={label}>
          Notes
        </label>
        <textarea
          id="entry-notes"
          value={draft.fields.notes}
          maxLength={LIMITS.notesChars}
          onChange={(e) => set("notes", e.target.value)}
          rows={6}
          placeholder="Recovery codes, security questions, anything else"
          className={`${textInput} resize-y`}
        />
      </div>

      {dialog === "generator" && (
        <Dialog title="Generate a password" onClose={() => setDialog(null)}>
          <Generator
            onCopy={props.onCopy}
            onUse={(password) => {
              onChange({ ...draft, fields: { ...draft.fields, password } });
              setRevealed(true);
              setDialog(null);
            }}
          />
        </Dialog>
      )}
      {dialog === "totp" && (
        <TotpSetup
          defaultIssuer={draft.fields.title}
          defaultLabel={draft.fields.username}
          onDone={(uri) => onChange({ ...draft, totp: uri })}
          onClose={() => setDialog(null)}
        />
      )}
    </form>
  );
}
