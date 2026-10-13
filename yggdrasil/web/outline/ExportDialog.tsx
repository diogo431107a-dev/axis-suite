// Export: a bullet (the zoomed-in one, or one picked from its dot menu) or the whole tree, as
// OPML, plain indented text or Markdown, downloaded or copied.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Copy, Download, X } from "lucide-react";
import { toOpml } from "../io/opml.ts";
import { toIndentedText, toMarkdown } from "../io/plaintext.ts";
import { plainText } from "../text/plain.ts";
import { useOutliner } from "./hooks.ts";

type Format = "opml" | "text" | "markdown";
const FORMATS: { id: Format; label: string; ext: string; type: string }[] = [
  { id: "opml", label: "OPML", ext: "opml", type: "text/x-opml" },
  { id: "text", label: "Plain text", ext: "txt", type: "text/plain" },
  { id: "markdown", label: "Markdown", ext: "md", type: "text/markdown" },
];
/** The preview shows this much; the download and copy have everything. */
const PREVIEW_CHARS = 20_000;

export function ExportDialog({ root, onClose }: { root: string | null; onClose: () => void }) {
  const o = useOutliner();
  const target = root ?? o.ui.view.zoom;
  const [scope, setScope] = useState<"bullet" | "all">(target ? "bullet" : "all");
  const [format, setFormat] = useState<Format>("opml");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const targetName = target ? plainText(o.store.get(target)?.content ?? "") || "Untitled" : "";
  const { output, title } = useMemo(() => {
    const source = o.textSource();
    const ids = scope === "bullet" && target ? [target] : [...source.children(null)];
    const title = scope === "bullet" && target ? targetName : "Yggdrasil";
    const output =
      format === "opml"
        ? toOpml(source, ids, title)
        : format === "text"
          ? toIndentedText(source, ids)
          : toMarkdown(source, ids);
    return { output, title };
  }, [o, scope, target, targetName, format]);

  const meta = FORMATS.find((f) => f.id === format)!;
  const download = () => {
    const url = URL.createObjectURL(new Blob([output], { type: `${meta.type};charset=utf-8` }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${
      title
        .replace(/[\\/:*?"<>|]+/g, " ")
        .trim()
        .slice(0, 80) || "Yggdrasil"
    }.${meta.ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copy = () => {
    void navigator.clipboard?.writeText(output).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 rounded-lg bg-white p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 id="export-title" className="text-lg font-semibold text-gray-900">
            Export
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:text-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex flex-wrap gap-x-10 gap-y-3 text-sm">
          <fieldset className="space-y-1">
            <legend className="mb-1 font-medium text-gray-700">What</legend>
            {target && (
              <Choice name="scope" checked={scope === "bullet"} onChange={() => setScope("bullet")}>
                “{targetName.length > 40 ? `${targetName.slice(0, 40)}…` : targetName}” and everything under it
              </Choice>
            )}
            <Choice name="scope" checked={scope === "all"} onChange={() => setScope("all")}>
              The whole outline
            </Choice>
          </fieldset>
          <fieldset className="space-y-1">
            <legend className="mb-1 font-medium text-gray-700">Format</legend>
            {FORMATS.map((f) => (
              <Choice key={f.id} name="format" checked={format === f.id} onChange={() => setFormat(f.id)}>
                {f.label}
              </Choice>
            ))}
          </fieldset>
        </div>
        <textarea
          readOnly
          aria-label="Preview"
          value={output.length > PREVIEW_CHARS ? `${output.slice(0, PREVIEW_CHARS)}\n…` : output}
          className="min-h-48 flex-1 resize-none rounded border border-gray-200 bg-gray-50 p-2 font-mono text-xs text-gray-700"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={copy}
            className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            <Copy className="h-4 w-4" />
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={download}
            className="flex items-center gap-1.5 rounded-md bg-green-700 px-3 py-1.5 text-sm text-white hover:bg-green-800"
          >
            <Download className="h-4 w-4" />
            Download .{meta.ext}
          </button>
        </div>
      </div>
    </div>
  );
}

function Choice({
  name,
  checked,
  onChange,
  children,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-gray-700">
      <input type="radio" name={name} checked={checked} onChange={onChange} className="accent-green-700" />
      {children}
    </label>
  );
}
