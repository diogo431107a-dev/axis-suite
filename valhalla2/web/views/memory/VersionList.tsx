import { useCallback, useEffect, useState } from "react";
import type { MemoryVersionInfo, MemoryVersionView } from "../../../shared/protocol.ts";
import { api, describeError } from "../../api.ts";
import { Button, Notice } from "../../ui/bits.tsx";
import { OPS, size, sourceOf, when } from "./format.ts";

export function VersionList({ base, path, onReverted }: { base: string; path: string; onReverted: () => void }) {
  const [versions, setVersions] = useState<MemoryVersionInfo[]>([]);
  const [shown, setShown] = useState<MemoryVersionView | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setVersions(await api<MemoryVersionInfo[]>(`${base}/versions?path=${encodeURIComponent(path)}`));
    } catch (err) {
      setError(describeError(err));
    }
  }, [base, path]);

  useEffect(() => {
    void load();
  }, [load]);

  const show = async (id: number) => {
    try {
      setShown(await api<MemoryVersionView>(`${base}/versions/${id}`));
    } catch (err) {
      setError(describeError(err));
    }
  };

  const revert = async (id: number) => {
    try {
      await api(`${base}/versions/${id}/revert`, { method: "POST" });
      setShown(null);
      await load();
      onReverted();
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <div className="space-y-3 rounded border border-rule bg-sheet/50 p-3">
      <h3 className="font-display">History</h3>
      <Notice>{error}</Notice>
      <ol className="space-y-1 text-sm">
        {versions.map((version, at) => (
          <li key={version.id}>
            <button
              type="button"
              onClick={() => void show(version.id)}
              className={`w-full rounded px-2 py-1 text-left hover:bg-sheet ${shown?.version.id === version.id ? "bg-accent-soft" : ""}`}
            >
              <span className="text-faint">{when(version.at)}</span> · {OPS[version.op] ?? version.op},{" "}
              {sourceOf(version.source)}
              {version.size === null ? "" : ` · ${size(version.size)}`}
              {at === 0 ? <span className="text-faint"> · as it is now</span> : null}
            </button>
          </li>
        ))}
      </ol>
      {shown ? (
        <div className="space-y-2">
          <pre className="overflow-x-auto rounded border border-rule bg-sheet p-3 font-mono text-xs leading-relaxed">
            {shown.diff.map((line, at) => (
              <div
                key={at}
                className={
                  line.kind === "added"
                    ? "bg-accent-soft"
                    : line.kind === "removed"
                      ? "text-warn line-through"
                      : "text-faint"
                }
              >
                {line.kind === "added" ? "+ " : line.kind === "removed" ? "− " : "  "}
                {line.text}
              </div>
            ))}
          </pre>
          {versions[0]?.id !== shown.version.id ? (
            <Button kind="plain" onClick={() => void revert(shown.version.id)}>
              {shown.content === null
                ? "Delete it again, as this change did"
                : "Put the file back as it was after this change"}
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-faint">Pick a change to see what it did.</p>
      )}
    </div>
  );
}
