// The file pane: starred bullets, top-level bullets and every tag with its count. Built from the
// whole tree, so it updates a moment after typing (useDeferredValue) rather than on every key.
import { useDeferredValue, useMemo, type ReactNode } from "react";
import { Hash, Star } from "lucide-react";
import type { Node } from "../../shared/protocol.ts";
import type { Store } from "../model/store.ts";
import { derived } from "../search/match.ts";
import { plainText } from "../text/plain.ts";
import { useOutliner, useTreeVersion, useView } from "./hooks.ts";
import { pathOf, zoomTo } from "./nav.ts";

interface Overview {
  starred: Node[];
  top: Node[];
  tags: [string, number][];
}

/** Walks the visible tree once: deleted bullets and what is under them don't count. */
function overview(store: Store): Overview {
  const starred: Node[] = [];
  const counts = new Map<string, number>();
  const walk = (parentId: string | null) => {
    for (const id of store.children(parentId)) {
      const node = store.get(id)!;
      if (node.deletedAt !== null) continue;
      if (node.starred) starred.push(node);
      for (const tag of new Set(derived(node).tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      walk(id);
    }
  };
  walk(null);
  const top = store
    .children(null)
    .map((id) => store.get(id)!)
    .filter((n) => n.deletedAt === null);
  const tags = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return { starred, top, tags };
}

export function Sidebar({ onPick }: { onPick?: () => void }) {
  const o = useOutliner();
  const version = useDeferredValue(useTreeVersion());
  const { zoom } = useView();
  // version is what changes; the store itself is always the same object.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => overview(o.store), [o, version]);

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
      {data.tags.length > 0 && (
        <Section title="Tags">
          {data.tags.map(([tag, count]) => (
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
    </nav>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</h2>
      <ul className="space-y-px">{children}</ul>
    </section>
  );
}
