// The page's main column: breadcrumbs, the zoomed-in bullet as the title, and its children.
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { looksLikeOpml, parseOpml } from "../io/opml.ts";
import { parsePlainText, toHtml, toPlainText } from "../io/plaintext.ts";
import * as cmd from "../model/commands.ts";
import type { Outliner } from "../model/outliner.ts";
import { visibleRows } from "../model/rows.ts";
import { Breadcrumbs } from "./Breadcrumbs.tsx";
import { Text } from "./Bullet.tsx";
import { Editor } from "./Editor.tsx";
import { useCaret, useNode, useOutliner, useShownChildren, useView } from "./hooks.ts";
import { selectionKeyDown } from "./keymap.ts";
import { zoomTo } from "./nav.ts";
import { VirtualRows } from "./VirtualRows.tsx";

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** Keyboard and clipboard for block selections, which have no focused element of their own. */
function useSelectionEvents(o: Outliner) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!o.ui.selection || isTyping(e.target)) return;
      selectionKeyDown(o, e);
    };
    const onCopy = (e: ClipboardEvent, cut: boolean) => {
      const sel = o.ui.selection;
      if (!sel || isTyping(e.target) || !e.clipboardData) return;
      e.preventDefault();
      e.clipboardData.setData("text/plain", toPlainText(o.textSource(), sel.ids));
      e.clipboardData.setData("text/html", toHtml(o.textSource(), sel.ids));
      if (cut) o.run((ctx) => cmd.remove(ctx, sel.ids));
    };
    const onPaste = (e: ClipboardEvent) => {
      const sel = o.ui.selection;
      if (!sel || isTyping(e.target) || !e.clipboardData) return;
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      let drafts = null;
      try {
        drafts = looksLikeOpml(text) ? parseOpml(text).drafts : null;
      } catch {
        // pasted as text
      }
      drafts ??= parsePlainText(text);
      o.run((ctx) => cmd.insertDrafts(ctx, sel.parentId, sel.ids.at(-1)!, drafts));
    };
    // A click outside the selected bullets ends the selection.
    const onDown = (e: MouseEvent) => {
      if (o.ui.selection && !(e.target as HTMLElement).closest?.("[data-dot]")) o.ui.clearSelection();
    };
    const copy = (e: ClipboardEvent) => onCopy(e, false);
    const cut = (e: ClipboardEvent) => onCopy(e, true);
    document.addEventListener("keydown", onKey);
    document.addEventListener("copy", copy);
    document.addEventListener("cut", cut);
    document.addEventListener("paste", onPaste);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("copy", copy);
      document.removeEventListener("cut", cut);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("mousedown", onDown);
    };
  }, [o]);
}

export function Outline() {
  const o = useOutliner();
  const view = useView();
  const { zoom } = view;
  const root = useNode(zoom);
  const kids = useShownChildren(zoom);
  // The rows change with the tree's shape and the view, not with typing.
  const structure = useSyncExternalStore(
    useCallback((cb: () => void) => o.store.subscribe(cb), [o]),
    () => o.store.structure,
  );
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => visibleRows(o.store, view), [o, view, structure]);
  useSelectionEvents(o);

  if (zoom !== null && (!root || root.deletedAt !== null)) {
    return (
      <div className="py-16 text-center text-gray-500">
        This bullet doesn’t exist, or it was deleted.{" "}
        <button type="button" className="text-sky-700 underline" onClick={() => zoomTo(o, null)}>
          Go to the top
        </button>
      </div>
    );
  }

  /** A click below the list edits the last bullet shown, or adds the first one. */
  const clickBelow = () => {
    const last = kids.at(-1);
    if (last) {
      const id = cmd.lastShownDescendant(o.ctx(), last);
      o.ui.setCaret(id, o.store.get(id)?.content.length ?? 0);
      return;
    }
    o.run((ctx) => {
      const { ops, ids } = cmd.insertDrafts(ctx, zoom, null, [{ content: "", children: [] }]);
      return { ops, caret: { id: ids[0]!, offset: 0 } };
    });
  };

  return (
    <div data-outline>
      <Breadcrumbs />
      {zoom !== null && <RootTitle id={zoom} />}
      <div className="pl-5">
        <VirtualRows rows={rows} />
      </div>
      <div className="min-h-[50vh] cursor-text" onClick={clickBelow}>
        {kids.length === 0 && <p className="pl-[42px] pt-1 text-gray-400">Click here to add a bullet.</p>}
      </div>
    </div>
  );
}

/** The zoomed-in bullet, as an editable page title with its note under it. */
function RootTitle({ id }: { id: string }) {
  const node = useNode(id)!;
  const caret = useCaret(id);
  return (
    <div className="mb-4 pl-[42px]">
      <h1 className="text-2xl font-semibold text-gray-900">
        {caret?.field === "content" ? <Editor id={id} field="content" /> : <Text id={id} text={node.content} />}
      </h1>
      {caret?.field === "note" ? (
        <Editor id={id} field="note" className="mt-1 text-sm text-gray-500" placeholder="Note" />
      ) : (
        node.note && <Text id={id} text={node.note} field="note" className="mt-1" />
      )}
    </div>
  );
}
