// The path to the zoomed-in bullet: Home, then each ancestor. Each one zooms out to there. Inside a
// bullet someone shares with the user, the path starts at that bullet, after who shares it.
import { Fragment, type ReactNode } from "react";
import { House } from "lucide-react";
import { plainText } from "../text/plain.ts";
import { useOutliner, useTreeVersion, useView } from "./hooks.ts";
import { pathOf, zoomTo } from "./nav.ts";

export function Breadcrumbs() {
  const o = useOutliner();
  const { zoom } = useView();
  useTreeVersion(); // an ancestor may be renamed or moved
  if (zoom === null) return null;

  const ancestors: { id: string; content: string }[] = [];
  let top = zoom;
  for (let id = o.store.get(zoom)?.parentId ?? null; id !== null;) {
    const node = o.store.get(id);
    if (!node) break;
    ancestors.unshift({ id, content: node.content });
    top = id;
    id = node.parentId;
  }
  const shared = o.store.sharedWithMe(top);
  const role = o.store.roleOf(zoom);

  const link = (id: string | null, label: ReactNode, title: string) => (
    <a
      href={pathOf(id)}
      title={title}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey) return; // open in a new tab as usual
        e.preventDefault();
        zoomTo(o, id);
      }}
      className="truncate rounded px-1 hover:bg-gray-100 hover:text-gray-800"
    >
      {label}
    </a>
  );

  return (
    <nav aria-label="Breadcrumbs" className="mb-2 flex min-w-0 flex-wrap items-center gap-0.5 text-sm text-gray-500">
      {link(null, <House className="h-4 w-4" />, "Home")}
      {shared && (
        <>
          <span className="text-gray-300">/</span>
          <span className="px-1 text-gray-400">Shared by {shared.owner}</span>
        </>
      )}
      {ancestors.map((a) => (
        <Fragment key={a.id}>
          <span className="text-gray-300">/</span>
          <span className="max-w-48 min-w-0">
            {link(a.id, plainText(a.content) || "Untitled", plainText(a.content))}
          </span>
        </Fragment>
      ))}
      {role !== "owner" && (
        <span className="ml-2 rounded bg-sky-50 px-1.5 text-xs text-sky-700">
          {role === "viewer" ? "Can read" : "Can edit"}
        </span>
      )}
    </nav>
  );
}
