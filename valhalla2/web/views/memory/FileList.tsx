import { FilePlus } from "lucide-react";
import type { MemoryPage } from "../../../shared/protocol.ts";
import { Button } from "../../ui/bits.tsx";
import { size } from "./format.ts";

export function FileList({
  page,
  chosen,
  onChoose,
}: {
  page: MemoryPage;
  chosen: string | null;
  onChoose: (path: string | null) => void;
}) {
  return (
    <nav className="space-y-1">
      {page.files.map((file) => (
        <button
          key={file.path}
          type="button"
          onClick={() => onChoose(file.path)}
          className={`block w-full rounded px-2 py-1.5 text-left text-sm ${
            chosen === file.path ? "bg-accent-soft" : "hover:bg-sheet"
          }`}
        >
          <span className="block truncate font-mono text-xs">{file.path}</span>
          <span
            className="mt-1 block h-1 overflow-hidden rounded bg-rule"
            title={`${size(file.size)} of ${size(file.cap)}`}
          >
            <span
              className={`block h-1 ${file.size / file.cap > 0.85 ? "bg-warn" : "bg-accent"}`}
              style={{ width: `${Math.min(100, (file.size / file.cap) * 100)}%` }}
            />
          </span>
          <span className="block text-xs text-faint">
            {size(file.size)} of {size(file.cap)}
          </span>
        </button>
      ))}
      <p className="px-2 pt-1 text-xs text-faint">
        {page.files.length} of {page.maxFiles} files.
      </p>
      {page.files.length < page.maxFiles ? (
        <div className="px-2">
          <Button kind="quiet" onClick={() => onChoose(null)}>
            <FilePlus size={14} /> New file
          </Button>
        </div>
      ) : null}
    </nav>
  );
}
