import { useState, type ReactNode } from "react";
import { Copy, ExternalLink, Eye, EyeOff, KeySquare, Pencil, RotateCcw, Trash2 } from "lucide-react";
import type { Entry } from "../../shared/protocol.ts";
import { api } from "../api.ts";
import { ServerCode } from "../totp/CodeDisplay.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { dangerButton, iconButton, label, primaryButton, secondaryButton } from "../ui/buttons.ts";
import { formatDate, openableUrl } from "../util.ts";

export type CopyKind = "username" | "password" | "code" | "url" | "setup link";

interface EntryViewProps {
  entry: Entry;
  groupPath: string;
  onEdit: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onPurge: () => void;
  onCopy: (kind: CopyKind, value: string) => void;
  /** the TOTP code on screen, for the copy shortcut */
  onCode: (code: string | null) => void;
  onError: (err: unknown) => void;
}

function Row({ name, children, actions }: { name: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="py-3 border-b border-gray-100 last:border-b-0">
      <div className={label}>{name}</div>
      <div className="flex items-center gap-2 min-h-8">
        <div className="flex-1 min-w-0">{children}</div>
        {actions && <div className="flex items-center gap-0.5 shrink-0">{actions}</div>}
      </div>
    </div>
  );
}

/** One entry, read-only, with buttons to copy each field. */
export function EntryView({ entry, groupPath, onCopy, onCode, onError, ...actions }: EntryViewProps) {
  const [revealed, setRevealed] = useState(false);
  const [setupLink, setSetupLink] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const showCode = (c: string | null) => {
    setCode(c);
    onCode(c);
  };
  const href = openableUrl(entry.url);
  const inBin = entry.deletedAt !== null;

  async function showSetupLink() {
    try {
      setSetupLink((await api<{ uri: string }>(`/api/entries/${entry.id}/totp/uri`)).uri);
    } catch (err) {
      onError(err);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-gray-800 break-words">{entry.title || "Untitled"}</h2>
          <p className="text-sm text-gray-400">{groupPath || "No group"}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          {inBin ? (
            <>
              <button type="button" className={secondaryButton} onClick={actions.onRestore}>
                <RotateCcw className="w-4 h-4" /> Restore
              </button>
              <button type="button" className={dangerButton} onClick={actions.onPurge}>
                <Trash2 className="w-4 h-4" /> Delete forever
              </button>
            </>
          ) : (
            <>
              <button type="button" className={primaryButton} onClick={actions.onEdit} title="Edit (E)">
                <Pencil className="w-4 h-4" /> Edit
              </button>
              <button
                type="button"
                className={secondaryButton}
                onClick={actions.onDelete}
                aria-label="Move to the recycle bin"
                title="Move to the recycle bin (Delete)"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {inBin && entry.deletedAt && (
        <p className="mb-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
          In the recycle bin since {formatDate(entry.deletedAt)}. It is deleted for good 30 days after that.
        </p>
      )}

      <Row
        name="Username"
        actions={
          <button
            type="button"
            className={iconButton}
            disabled={!entry.username}
            onClick={() => onCopy("username", entry.username)}
            aria-label="Copy username"
            title="Copy username (Ctrl+B)"
          >
            <Copy className="w-4 h-4" />
          </button>
        }
      >
        <span className="text-sm text-gray-800 break-all select-all">{entry.username || "—"}</span>
      </Row>

      <Row
        name="Password"
        actions={
          <>
            <button
              type="button"
              className={iconButton}
              disabled={!entry.password}
              onClick={() => setRevealed((r) => !r)}
              aria-label={revealed ? "Hide password" : "Show password"}
              title={revealed ? "Hide" : "Show"}
            >
              {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
            <button
              type="button"
              className={iconButton}
              disabled={!entry.password}
              onClick={() => onCopy("password", entry.password)}
              aria-label="Copy password"
              title="Copy password (Ctrl+C)"
            >
              <Copy className="w-4 h-4" />
            </button>
          </>
        }
      >
        {!entry.password ? (
          <span className="text-sm text-gray-800">—</span>
        ) : revealed ? (
          <span className="font-mono text-sm text-gray-900 break-all select-all">{entry.password}</span>
        ) : (
          <span className="font-mono text-sm text-gray-500 tracking-widest">••••••••••••</span>
        )}
      </Row>

      {entry.totp && (
        <Row
          name={`TOTP${entry.totp.issuer ? ` · ${entry.totp.issuer}` : ""}`}
          actions={
            !inBin && (
              <>
                <button
                  type="button"
                  className={iconButton}
                  disabled={!code}
                  onClick={() => code && onCopy("code", code)}
                  aria-label="Copy code"
                  title="Copy code (T)"
                >
                  <Copy className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  className={iconButton}
                  onClick={showSetupLink}
                  aria-label="Show setup link"
                  title="Show the setup link, to add this TOTP to another authenticator"
                >
                  <KeySquare className="w-4 h-4" />
                </button>
              </>
            )
          }
        >
          {inBin ? (
            <span className="text-sm text-gray-400">Restore the entry to see its codes.</span>
          ) : (
            <ServerCode entryId={entry.id} rev={entry.rev} onCode={showCode} onError={onError} />
          )}
        </Row>
      )}

      <Row
        name="URL"
        actions={
          <>
            {href && (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={iconButton}
                aria-label="Open the URL"
                title="Open (Ctrl+U)"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
            <button
              type="button"
              className={iconButton}
              disabled={!entry.url}
              onClick={() => onCopy("url", entry.url)}
              aria-label="Copy URL"
              title="Copy URL"
            >
              <Copy className="w-4 h-4" />
            </button>
          </>
        }
      >
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-700 hover:underline break-all"
          >
            {entry.url}
          </a>
        ) : (
          <span className="text-sm text-gray-800 break-all">{entry.url || "—"}</span>
        )}
      </Row>

      {entry.notes && (
        <Row name="Notes">
          <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{entry.notes}</p>
        </Row>
      )}

      <p className="mt-4 text-xs text-gray-400">
        Created {formatDate(entry.createdAt)} · Changed {formatDate(entry.updatedAt)}
      </p>

      {setupLink !== null && (
        <Dialog title="TOTP setup link" onClose={() => setSetupLink(null)}>
          <p className="text-sm text-gray-500 mb-3">
            Another authenticator app can take this TOTP from the link below. It holds the secret key: whoever has it
            can make your codes.
          </p>
          <p className="font-mono text-xs text-gray-800 break-all select-all rounded-lg bg-gray-50 border border-gray-200 p-3">
            {setupLink}
          </p>
          <div className="mt-4 flex justify-end">
            <button type="button" className={secondaryButton} onClick={() => onCopy("setup link", setupLink)}>
              <Copy className="w-4 h-4" /> Copy
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
