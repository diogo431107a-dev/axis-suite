// The sidebar's tree of bullets: every bullet can be unfolded to show its children, apart from
// the outline's own collapsing (sidebarFolds). Only unfolded bullets are drawn, so a large tree
// costs no more than what is open. Completed bullets follow "Completed shown"; a search doesn't
// filter it. Each row is a place to drop dragged bullets (data-move-target, see dnd.ts).
import { memo, type ReactNode } from "react";
import { ChevronRight, House } from "lucide-react";
import type { Node } from "../../shared/protocol.ts";
import { plainText } from "../text/plain.ts";
import { useOutliner } from "./hooks.ts";
import { pathOf, zoomTo } from "./nav.ts";
import { exists, sidebarChildren, sidebarFolds, useSidebarFolds } from "./sidebarFolds.ts";

/** Per row, depth in pixels. */
const STEP = 12;

interface RowProps {
  node: Node;
  /**
   * The tree's version as the sidebar last took it (deferred): rows draw again when it changes,
   * not on every key typed in the outline.
   */
  version: number;
  depth: number;
  zoom: string | null;
  showCompleted: boolean;
  onPick?: () => void;
  icon?: ReactNode;
  detail?: string;
  /** Shown over the row's right end on hover (the ✕ of a bullet shared with the user). */
  after?: ReactNode;
}

/** A bullet and, when unfolded, its children. */
export const TreeRow = memo(function TreeRow({
  node,
  // Only passed on: it is here so that memo draws the row again when the tree changes.
  // oxlint-disable-next-line only-used-in-recursion
  version,
  depth,
  zoom,
  showCompleted,
  onPick,
  icon,
  detail,
  after,
}: RowProps) {
  const o = useOutliner();
  const unfolded = useSidebarFolds();
  const kids = sidebarChildren(o, node.id, showCompleted);
  const open = kids.length > 0 && unfolded.has(node.id);
  const name = plainText(node.content) || "Untitled";
  return (
    <li>
      <Row
        target={node.id}
        readOnly={o.store.roleOf(node.id) === "viewer"}
        depth={depth}
        active={zoom === node.id}
        href={pathOf(node.id)}
        onGo={() => {
          zoomTo(o, node.id);
          onPick?.();
        }}
        toggle={
          kids.length > 0 && (
            <button
              type="button"
              aria-label={open ? `Fold ${name}` : `Unfold ${name}`}
              aria-expanded={open}
              onClick={() => sidebarFolds.toggle(node.id, exists(o))}
              className="flex h-6 w-4 shrink-0 items-center justify-center text-gray-400 hover:text-gray-700"
            >
              <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
            </button>
          )
        }
        icon={icon}
        detail={detail}
        after={after}
      >
        {name}
      </Row>
      {open && (
        <ul className="space-y-px">
          {kids.map((k) => (
            <TreeRow
              key={k.id}
              node={k}
              version={version}
              depth={depth + 1}
              zoom={zoom}
              showCompleted={showCompleted}
              onPick={onPick}
            />
          ))}
        </ul>
      )}
    </li>
  );
});

/** The top of the tree: Home, then the user's top-level bullets. */
export function HomeRow({ zoom, onPick }: { zoom: string | null; onPick?: () => void }) {
  const o = useOutliner();
  return (
    <li>
      <Row
        target=""
        depth={0}
        active={zoom === null}
        href={pathOf(null)}
        onGo={() => {
          zoomTo(o, null);
          onPick?.();
        }}
        toggle={null}
        icon={<House className="h-3.5 w-3.5 shrink-0 text-gray-400" />}
      >
        Home
      </Row>
    </li>
  );
}

interface RowLookProps {
  /** The bullet dropped bullets go into ("" for the top level). */
  target: string;
  readOnly?: boolean;
  depth: number;
  active: boolean;
  href: string;
  onGo: () => void;
  toggle: ReactNode;
  icon?: ReactNode;
  detail?: string;
  after?: ReactNode;
  children: ReactNode;
}

function Row({ target, readOnly, depth, active, href, onGo, toggle, icon, detail, after, children }: RowLookProps) {
  return (
    <div
      data-move-target={target}
      data-move-readonly={readOnly || undefined}
      className={`group relative flex items-center rounded hover:bg-gray-100 ${
        active ? "bg-gray-100 font-medium text-gray-900" : "text-gray-600"
      }`}
      style={{ paddingLeft: depth * STEP }}
    >
      {toggle || <span className="w-4 shrink-0" />}
      <a
        href={href}
        onClick={(e) => {
          if (e.ctrlKey || e.metaKey || e.shiftKey) return;
          e.preventDefault();
          onGo();
        }}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-2"
      >
        {icon}
        <span className="truncate">{children}</span>
        {detail && <span className="ml-auto shrink-0 pl-1 text-xs text-gray-400">{detail}</span>}
      </a>
      {after}
    </div>
  );
}
