import { useCallback, useEffect, useState } from "react";
import { History, Pencil, Trash2 } from "lucide-react";
import type { MemoryFileView } from "../../../shared/protocol.ts";
import { api, describeError } from "../../api.ts";
import { Button, inputStyle, Notice } from "../../ui/bits.tsx";
import { size } from "./format.ts";
import { VersionList } from "./VersionList.tsx";

export function FilePane({
  base,
  path,
  onChanged,
  onGone,
}: {
  base: string;
  path: string;
  onChanged: () => void;
  onGone: () => void;
}) {
  const [file, setFile] = useState<MemoryFileView | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const query = `path=${encodeURIComponent(path)}`;

  const load = useCallback(async () => {
    try {
      setFile(await api<MemoryFileView>(`${base}/file?${query}`));
    } catch (err) {
      setError(describeError(err));
    }
  }, [base, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (draft === null) return;
    try {
      setFile(await api<MemoryFileView>(`${base}/file`, { method: "PUT", body: { path, content: draft } }));
      setDraft(null);
      setError("");
      onChanged();
    } catch (err) {
      setError(describeError(err));
    }
  };

  const remove = async () => {
    try {
      await api(`${base}/file?${query}`, { method: "DELETE" });
      onGone();
    } catch (err) {
      setError(describeError(err));
    }
  };

  if (!file) return <Notice>{error}</Notice>;
  const bytes = draft === null ? 0 : new TextEncoder().encode(draft).length;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-mono text-sm">/memories/{path}</h2>
        <span className="ml-auto flex flex-wrap gap-1">
          {draft === null ? (
            <Button kind="plain" onClick={() => setDraft(file.content)}>
              <Pencil size={14} /> Edit
            </Button>
          ) : null}
          <Button kind="plain" onClick={() => setShowHistory((shown) => !shown)}>
            <History size={14} /> History
          </Button>
          {confirming ? (
            <>
              <Button kind="danger" onClick={() => void remove()}>
                Delete
              </Button>
              <Button kind="quiet" onClick={() => setConfirming(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button kind="danger" onClick={() => setConfirming(true)}>
              <Trash2 size={14} />
            </Button>
          )}
        </span>
      </div>
      <Notice>{error}</Notice>

      {draft === null ? (
        <pre className="spoken overflow-x-auto rounded border border-rule bg-sheet p-3 font-mono text-xs leading-relaxed">
          {file.content}
        </pre>
      ) : (
        <div className="space-y-2">
          <textarea
            className={`${inputStyle} min-h-80 resize-y font-mono text-xs leading-relaxed`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button kind="strong" onClick={() => void save()} disabled={bytes > file.cap}>
              Save
            </Button>
            <Button kind="quiet" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <span className={`ml-auto text-xs ${bytes > file.cap ? "text-warn" : "text-faint"}`}>
              {size(bytes)} of {size(file.cap)}
            </span>
          </div>
        </div>
      )}

      {showHistory ? (
        <VersionList
          base={base}
          path={path}
          onReverted={() => {
            void load();
            onChanged();
          }}
        />
      ) : null}
    </section>
  );
}
