// The file pane: starred bullets, top-level bullets, and the tags inside the zoomed-in bullet with
// their counts. Built from the whole tree, so it updates a moment after typing (useDeferredValue)
// rather than on every key.
import { useDeferredValue, useMemo, useRef, type ReactNode } from "react";
import { Download, Hash, Star, Upload } from "lucide-react";
import type { Node } from "../../shared/protocol.ts";
import { importFile } from "../io/importer.ts";
import type { Store } from "../model/store.ts";
import { tagCounts } from "../search/run.ts";
import { plainText } from "../text/plain.ts";
import { useOutliner, useTreeVersion, useView } from "./hooks.ts";
import { pathOf, zoomTo } from "./nav.ts";

interface Overview {
  starred: Node[];
  top: Node[];
}

/** Walks the visible tree once: deleted bullets and what is under them don't count. */
function overview(store: Store): Overview {
  const starred: Node[] = [];
  const walk = (parentId: string | null) => {
    for (const id of store.children(parentId)) {
      const node = store.get(id)!;
      if (node.deletedAt !== null) continue;
      if (node.starred) starred.push(node);
      walk(id);
    }
  };
  walk(null);
  const top = store
    .children(null)
    .map((id) => store.get(id)!)
    .filter((n) => n.deletedAt === null);
  return { starred, top };
}

export function Sidebar({ onPick }: { onPick?: () => void }) {
  const o = useOutliner();
  const fileInput = useRef<HTMLInputElement>(null);
  const version = useDeferredValue(useTreeVersion());
  const { zoom, showCompleted } = useView();
  // version is what changes; the store itself is always the same object.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => overview(o.store), [o, version]);
  // Like search, the tags are those inside the zoomed-in bullet: Home lists them all.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const tags = useMemo(() => tagCounts(o.store, zoom, showCompleted), [o, version, zoom, showCompleted]);
  const zoomName = zoom && (plainText(o.store.get(zoom)?.content ?? "") || "Untitled");

  const go = (id: string) => {
    zoomTo(o, id);
    onPick?.();
  };
  const link = (node: Node, icon?: ReactNode) => (
    <li key={node.id}>
      <a
        href={pathOf(node.id)}
        onClick={(e) => {
          if (e.ctrlKey || e.metaKey || e.shiftKey) return;
          e.preventDefault();
          go(node.id);
        }}
        className={`flex items-center gap-1.5 truncate rounded px-2 py-1 hover:bg-gray-100 ${
          zoom === node.id ? "bg-gray-100 font-medium text-gray-900" : "text-gray-600"
        }`}
      >
        {icon}
        <span className="truncate">{plainText(node.content) || "Untitled"}</span>
      </a>
    </li>
  );

  return (
    <nav aria-label="Sidebar" className="space-y-5 p-3 text-sm">
      {data.starred.length > 0 && (
        <Section title="Starred">
          {data.starred.map((n) => link(n, <Star className="h-3.5 w-3.5 shrink-0 fill-amber-300 text-amber-400" />))}
        </Section>
      )}
      <Section title="Top level">
        {data.top.length > 0 ? data.top.map((n) => link(n)) : <li className="px-2 text-gray-400">Nothing yet</li>}
      </Section>
      {tags.length > 0 && (
        <Section title={zoomName ? `Tags in ${zoomName}` : "Tags"}>
          {tags.map(([tag, count]) => (
            <li key={tag}>
              <button
                type="button"
                onClick={() => {
                  o.setQuery(`#${tag}`);
                  onPick?.();
                }}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-gray-600 hover:bg-gray-100"
              >
                <Hash className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                <span className="flex-1 truncate">{tag}</span>
                <span className="text-xs tabular-nums text-gray-400">{count}</span>
              </button>
            </li>
          ))}
        </Section>
      )}
      <section className="space-y-px border-t border-gray-100 pt-3">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-gray-600 hover:bg-gray-100"
        >
          <Upload className="h-3.5 w-3.5 text-gray-400" />
          Import OPML…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".opml,.xml,text/x-opml,application/xml,text/xml"
          className="hidden"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (file) void importFile(o, file).then(() => onPick?.());
          }}
        />
        <button
          type="button"
          onClick={() => {
            o.ui.setDialog({ kind: "export", root: null });
            onPick?.();
          }}
          className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-gray-600 hover:bg-gray-100"
        >
          <Download className="h-3.5 w-3.5 text-gray-400" />
          Export…
        </button>
      </section>
    </nav>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 title={title} className="mb-1 truncate px-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
        {title}
      </h2>
      <ul className="space-y-px">{children}</ul>
    </section>
  );
}
