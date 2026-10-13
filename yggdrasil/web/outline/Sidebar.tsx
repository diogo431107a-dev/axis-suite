// The file pane: starred bullets, top-level bullets, the bullets shared with the user and those
// they share, and the tags inside the zoomed-in bullet with their counts. Built from the whole
// tree, so it updates a moment after typing (useDeferredValue) rather than on every key.
import { useDeferredValue, useMemo, useRef, type ReactNode } from "react";
import { Download, Hash, Star, Upload, Users, X } from "lucide-react";
import type { Node } from "../../shared/protocol.ts";
import { importFile } from "../io/importer.ts";
import { removeShare } from "../model/sharing.ts";
import type { Store } from "../model/store.ts";
import { tagCounts } from "../search/run.ts";
import { plainText } from "../text/plain.ts";
import { useOutliner, useTreeVersion, useView } from "./hooks.ts";
import { pathOf, zoomTo } from "./nav.ts";

interface Overview {
  starred: Node[];
  top: Node[];
  /** The bullets shared with the user, with their owners, by owner. */
  withMe: { node: Node; owner: string }[];
  /** The user's bullets they share, in the order of their tree. */
  byMe: Node[];
}

/** Walks the visible tree once: deleted bullets and what is under them don't count. */
function overview(store: Store): Overview {
  const starred: Node[] = [];
  const byMe: Node[] = [];
  const walk = (ids: readonly string[]) => {
    for (const id of ids) {
      const node = store.get(id)!;
      if (node.deletedAt !== null) continue;
      if (node.starred) starred.push(node);
      if (store.sharesOf(id).length > 0) byMe.push(node);
      walk(store.children(id));
    }
  };
  walk(store.children(null));
  const shared = store.sharedRoots().filter((id) => store.get(id)?.deletedAt === null);
  walk(shared);
  const top = store
    .children(null)
    .map((id) => store.get(id)!)
    .filter((n) => n.deletedAt === null);
  const withMe = shared
    .map((id) => ({ node: store.get(id)!, owner: store.sharedWithMe(id)?.owner ?? "" }))
    .sort(
      (a, b) => a.owner.localeCompare(b.owner) || plainText(a.node.content).localeCompare(plainText(b.node.content)),
    );
  return { starred, top, withMe, byMe };
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

  // Takes a bullet someone shares with the user off their list: the sharing stops for them.
  const leave = async (id: string) => {
    try {
      if (o.ui.view.zoom === id) zoomTo(o, null);
      await removeShare(o, id, o.username);
    } catch (err) {
      o.notice(err instanceof Error ? err.message : String(err));
    }
  };

  const go = (id: string) => {
    zoomTo(o, id);
    onPick?.();
  };
  const link = (node: Node, icon?: ReactNode, detail?: string, after?: ReactNode) => (
    <li key={node.id} className="group relative">
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
        {detail && <span className="ml-auto shrink-0 pl-1 text-xs text-gray-400">{detail}</span>}
      </a>
      {after}
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
      {data.withMe.length > 0 && (
        <Section title="Shared with me">
          {data.withMe.map(({ node, owner }) =>
            link(
              node,
              <Users className="h-3.5 w-3.5 shrink-0 text-sky-600" />,
              owner,
              <button
                type="button"
                title="Remove from my list"
                aria-label={`Remove ${plainText(node.content) || "Untitled"} from my list`}
                onClick={() => void leave(node.id)}
                className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded bg-gray-100 p-0.5 text-gray-400 hover:text-red-600 group-hover:block focus:block"
              >
                <X className="h-3.5 w-3.5" />
              </button>,
            ),
          )}
        </Section>
      )}
      {data.byMe.length > 0 && (
        <Section title="Shared by me">
          {data.byMe.map((n) => link(n, <Users className="h-3.5 w-3.5 shrink-0 text-sky-600" />))}
        </Section>
      )}
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
