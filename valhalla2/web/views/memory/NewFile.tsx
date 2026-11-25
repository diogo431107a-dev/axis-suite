import { useState } from "react";
import type { MemoryFileView } from "../../../shared/protocol.ts";
import { api, describeError } from "../../api.ts";
import { Button, inputStyle, Notice } from "../../ui/bits.tsx";

export function NewFile({ base, onCreated }: { base: string; onCreated: (path: string) => void }) {
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const create = async () => {
    try {
      const saved = await api<MemoryFileView>(`${base}/file`, {
        method: "PUT",
        body: { path, content: `# ${path}\n` },
      });
      onCreated(saved.path);
    } catch (err) {
      setError(describeError(err));
    }
  };
  return (
    <div className="space-y-3 rounded border border-rule bg-sheet/50 p-4 text-sm">
      <p className="text-faint">Pick a file on the left to read it, or start a new one.</p>
      <div className="flex gap-2">
        <input
          className={`${inputStyle} font-mono`}
          value={path}
          placeholder="places/the_hall.md"
          onChange={(e) => setPath(e.target.value)}
        />
        <Button kind="plain" onClick={() => void create()} disabled={!path.trim()}>
          Create
        </Button>
      </div>
      <Notice>{error}</Notice>
    </div>
  );
}
