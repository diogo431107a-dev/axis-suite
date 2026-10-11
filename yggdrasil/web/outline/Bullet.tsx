// One bullet and, unless it is collapsed, its children. Memoized and subscribed to its own node,
// so typing re-renders one bullet; children of collapsed bullets aren't mounted at all.
import { memo, useCallback, useRef, useState, type MouseEvent } from "react";
import { ChevronRight, Ellipsis, Star } from "lucide-react";
import * as cmd from "../model/commands.ts";
import type { Field } from "../model/ui.ts";
import { Inline } from "../text/Inline.tsx";
import { sourceOffsetAt } from "./caret.ts";
import { BulletMenu } from "./BulletMenu.tsx";
import { onDotPointerDown } from "./dnd.ts";
import { Editor } from "./Editor.tsx";
import { useCaret, useNode, useOutliner, useSelected, useShownChildren, useView } from "./hooks.ts";

export const Bullet = memo(function Bullet({ id }: { id: string }) {
  const o = useOutliner();
  const node = useNode(id);
  const kids = useShownChildren(id);
  const caret = useCaret(id);
  const selected = useSelected(id);
  const view = useView();
  const [menu, setMenu] = useState(false);
  const closeMenu = useCallback(() => setMenu(false), []);
  if (!node) return null;

  const hasKids = kids.length > 0;
  const highlight = view.matches?.has(id) ? view.highlight : null;
  const expanded = hasKids && (view.filter !== null || !node.collapsed);
  const completed = node.completedAt !== null;

  return (
    <div data-bullet={id}>
      <div
        data-row={id}
        className={`group relative flex items-start rounded-sm ${selected ? "bg-sky-100 ring-1 ring-sky-300" : ""}`}
      >
        {hasKids && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={expanded ? "Collapse" : "Expand"}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => o.run((ctx) => cmd.setCollapsed(ctx, id, !node.collapsed))}
            className="absolute -left-5 top-0 flex h-[1.6em] w-5 items-center justify-center text-gray-400
                       opacity-0 transition-opacity hover:text-gray-700 group-hover:opacity-100"
          >
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
          </button>
        )}
        <span
          data-dot={id}
          title="Drag to move, click to zoom in"
          onPointerDown={(e) => onDotPointerDown(o, id, e)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu(true);
          }}
          className="flex h-[1.6em] w-[22px] shrink-0 cursor-pointer touch-none items-center justify-center"
        >
          <span
            className={`block h-[7px] w-[7px] rounded-full ${completed ? "bg-gray-300" : "bg-gray-600"} ${
              hasKids && !expanded ? "ring-[5px] ring-gray-200" : ""
            }`}
          />
        </span>
        <div className={`min-w-0 flex-1 ${completed ? "text-gray-400 line-through" : ""}`}>
          {caret?.field === "content" ? (
            <Editor id={id} field="content" />
          ) : (
            <Text id={id} text={node.content} highlight={highlight} />
          )}
          {caret?.field === "note" ? (
            <Editor id={id} field="note" className="text-sm text-gray-500" placeholder="Note" />
          ) : (
            node.note && <Text id={id} text={node.note} field="note" highlight={highlight} />
          )}
        </div>
        {node.starred && (
          <Star aria-label="Starred" className="mt-[0.35em] h-3.5 w-3.5 shrink-0 fill-amber-300 text-amber-400" />
        )}
        <button
          type="button"
          tabIndex={-1}
          aria-label="Bullet menu"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setMenu((m) => !m)}
          className="ml-1 flex h-[1.6em] w-6 shrink-0 items-center justify-center text-gray-300 opacity-0
                     transition-opacity hover:text-gray-600 group-hover:opacity-100"
        >
          <Ellipsis className="h-4 w-4" />
        </button>
        {menu && <BulletMenu id={id} onClose={closeMenu} />}
      </div>
      {expanded && (
        <div className="ml-[10px] border-l border-gray-200 pl-[13px]">
          {kids.map((k) => (
            <Bullet key={k} id={k} />
          ))}
        </div>
      )}
    </div>
  );
});

interface TextProps {
  id: string;
  text: string;
  field?: Field;
  className?: string;
  highlight?: RegExp | null;
}

/** Formatted text; a click starts editing with the caret on the clicked character. */
export function Text({ id, text, field = "content", className = "", highlight = null }: TextProps) {
  const o = useOutliner();
  const ref = useRef<HTMLDivElement>(null);
  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("a, button, input")) return;
    // A tag or mention searches for it.
    const tag = target.closest<HTMLElement>("[data-tag]");
    if (tag) {
      o.setQuery(tag.dataset.tag!);
      return;
    }
    // Leave a selection made with the mouse alone, so it can be copied.
    if (!window.getSelection()?.isCollapsed) return;
    const offset = sourceOffsetAt(ref.current!, e.clientX, e.clientY, text.length) ?? text.length;
    o.ui.setCaret(id, offset, field);
  };
  const look = field === "note" ? "line-clamp-3 text-sm text-gray-500" : "min-h-[1.6em]";
  return (
    <div
      ref={ref}
      data-text={field === "content" ? id : undefined}
      onClick={onClick}
      className={`ygg-text cursor-text ${look} ${className}`}
    >
      {text ? <Inline text={text} highlight={highlight} id={id} field={field} /> : <br />}
    </div>
  );
}
