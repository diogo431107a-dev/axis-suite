// Keyboard handling: one function for the bullet being edited, one for a block selection.
// The table of keys is in the README.
import * as cmd from "../model/commands.ts";
import type { Outliner } from "../model/outliner.ts";
import type { Field } from "../model/ui.ts";
import { caretClientX, onFirstLine, onLastLine, sourceOffsetOnLine } from "./caret.ts";
import { zoomTo } from "./nav.ts";

type Keys = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "preventDefault">;

/** The rendered text of a bullet: <Text> marks it with data-text. */
export const textElement = (id: string) => document.querySelector<HTMLElement>(`[data-text="${CSS.escape(id)}"]`);

/** Edits `id` with the caret under x on its first or last line, as arrow keys do. */
export function focusLine(o: Outliner, id: string, x: number, line: "first" | "last"): void {
  const content = o.store.get(id)?.content ?? "";
  const el = textElement(id);
  const offset = el ? sourceOffsetOnLine(el, x, line, content.length) : line === "first" ? 0 : content.length;
  o.ui.setCaret(id, offset);
}

/** Selects bullet id as a block (Esc). */
export function selectBlock(o: Outliner, id: string): void {
  const node = o.store.get(id);
  if (!node || id === o.ui.view.zoom) return;
  o.history.seal();
  o.ui.select({ parentId: node.parentId, anchor: id, head: id }, [id]);
}

/** Completes or uncompletes bullets; if completed ones are hidden, the caret moves on. */
function complete(o: Outliner, ids: string[], editing: boolean): void {
  const ctx = o.ctx();
  const next = cmd.below(ctx, ids.at(-1)!, false) ?? cmd.above(ctx, ids[0]!);
  o.run((c) => cmd.toggleComplete(c, ids));
  const hidden = !o.ui.view.showCompleted && o.store.get(ids[0]!)?.completedAt !== null;
  if (hidden && next) {
    if (editing) o.ui.setCaret(next, o.store.get(next)!.content.length);
    else o.ui.select({ parentId: o.store.get(next)!.parentId, anchor: next, head: next }, [next]);
  }
}

function zoomIn(o: Outliner, id: string): void {
  zoomTo(o, id);
  o.ui.setCaret(id, o.store.get(id)?.content.length ?? 0);
}

function zoomOut(o: Outliner): void {
  const root = o.ui.view.zoom;
  if (root === null) return;
  zoomTo(o, o.store.get(root)?.parentId ?? null);
  o.ui.setCaret(root, o.store.get(root)?.content.length ?? 0);
}

/** Handles a key in the editor of bullet id. Keys it doesn't handle keep their default. */
export function editorKeyDown(o: Outliner, e: Keys, ta: HTMLTextAreaElement, id: string, field: Field): void {
  const mod = e.ctrlKey || e.metaKey;
  const plain = !mod && !e.shiftKey && !e.altKey;
  const { selectionStart: start, selectionEnd: end, value } = ta;
  const atStart = start === 0 && end === 0;
  const atEnd = start === value.length && end === value.length;
  const node = o.store.get(id);
  if (!node) return;
  // Commands that remount the bullet bring the caret back where it is now.
  o.ui.rememberCaret(id, field, start, end);
  const handled = () => e.preventDefault();
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  switch (key) {
    case "Enter":
      if (mod && !e.shiftKey && !e.altKey) {
        complete(o, [id], true);
        return handled();
      }
      if (e.shiftKey && !mod && !e.altKey) {
        // Shift+Enter switches between the bullet's text and its note.
        if (field === "content") o.ui.setCaret(id, node.note.length, "note");
        else o.ui.setCaret(id, node.content.length, "content");
        return handled();
      }
      if (plain && field === "content") {
        o.run((ctx) => cmd.enter(ctx, id, start, end));
        return handled();
      }
      return;

    case "Tab":
      if (mod || e.altKey) return;
      o.run((ctx) => (e.shiftKey ? cmd.outdent(ctx, [id]) : cmd.indent(ctx, [id])));
      return handled(); // never move focus out of the outline

    case "Backspace":
      if (!plain || !atStart) return;
      if (field === "note") {
        if (value === "") {
          o.ui.setCaret(id, node.content.length);
          handled();
        }
        return;
      }
      if (o.run((ctx) => cmd.backspaceAtStart(ctx, id))) handled();
      return;

    case "Delete":
      if (plain && atEnd && field === "content" && o.run((ctx) => cmd.deleteAtEnd(ctx, id))) handled();
      return;

    case "ArrowUp":
    case "ArrowDown": {
      const up = key === "ArrowUp";
      if (mod && e.shiftKey && !e.altKey) {
        o.run((ctx) => (up ? cmd.moveUp(ctx, [id]) : cmd.moveDown(ctx, [id])));
        return handled();
      }
      if (mod && !e.shiftKey && !e.altKey) {
        o.run((ctx) => cmd.setCollapsed(ctx, id, up));
        return handled();
      }
      const edge = up ? onFirstLine(ta) : onLastLine(ta);
      if (e.shiftKey && !mod && !e.altKey) {
        if (edge && field === "content") {
          selectBlock(o, id);
          handled();
        }
        return;
      }
      if (!plain || !edge) return;
      if (field === "note" && up) {
        o.ui.setCaret(id, node.content.length);
        return handled();
      }
      const ctx = o.ctx();
      const target = up ? cmd.above(ctx, id) : cmd.below(ctx, id);
      if (target) focusLine(o, target, caretClientX(ta), up ? "last" : "first");
      else ta.setSelectionRange(up ? 0 : value.length, up ? 0 : value.length);
      return handled();
    }

    case "ArrowLeft":
    case "ArrowRight": {
      const left = key === "ArrowLeft";
      if (e.altKey && !mod && !e.shiftKey) {
        if (left) zoomOut(o);
        else zoomIn(o, id);
        return handled();
      }
      if (!plain || field !== "content" || !(left ? atStart : atEnd)) return;
      const ctx = o.ctx();
      const target = left ? cmd.above(ctx, id) : cmd.below(ctx, id);
      if (!target) return;
      o.ui.setCaret(target, left ? (o.store.get(target)?.content.length ?? 0) : 0);
      return handled();
    }

    case "]":
    case "[":
      if (!mod || e.shiftKey || e.altKey) return;
      if (key === "]") zoomIn(o, id);
      else zoomOut(o);
      return handled();

    case "z":
      if (!mod || e.altKey) return;
      if (e.shiftKey) o.redo();
      else o.undo();
      return handled();

    case "y":
      if (!mod || e.shiftKey || e.altKey) return;
      o.redo();
      return handled();

    case "Escape":
      selectBlock(o, id);
      return handled();
  }
}

/** Handles a key while bullets are selected as blocks. */
export function selectionKeyDown(o: Outliner, e: Keys): void {
  const sel = o.ui.selection;
  if (!sel) return;
  const mod = e.ctrlKey || e.metaKey;
  const ids = sel.ids;
  const handled = () => e.preventDefault();
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const selectOne = (id: string) => o.ui.select({ parentId: o.store.get(id)!.parentId, anchor: id, head: id }, [id]);

  switch (key) {
    case "Enter":
      if (mod && !e.shiftKey) complete(o, ids, false);
      else o.ui.setCaret(sel.head, o.store.get(sel.head)?.content.length ?? 0);
      return handled();

    case "Escape":
      o.ui.setCaret(sel.head, o.store.get(sel.head)?.content.length ?? 0);
      return handled();

    case "ArrowUp":
    case "ArrowDown": {
      const up = key === "ArrowUp";
      const ctx = o.ctx();
      if (mod && e.shiftKey) {
        o.run((c) => (up ? cmd.moveUp(c, ids) : cmd.moveDown(c, ids)));
      } else if (mod) {
        o.commit({ ops: ids.flatMap((id) => cmd.setCollapsed(ctx, id, up)?.ops ?? []) });
      } else if (e.shiftKey) {
        extendSelection(o, up);
      } else {
        const target = up ? cmd.above(ctx, ids[0]!) : cmd.below(ctx, ids.at(-1)!);
        if (target && target !== ctx.root) selectOne(target);
      }
      return handled();
    }

    case "Tab":
      if (mod || e.altKey) return;
      o.run((ctx) => (e.shiftKey ? cmd.outdent(ctx, ids) : cmd.indent(ctx, ids)));
      return handled();

    case "Backspace":
    case "Delete":
      if (mod || e.altKey) return;
      o.run((ctx) => cmd.remove(ctx, ids));
      o.ui.clearSelection();
      return handled();

    case "a":
      if (!mod) return;
      {
        const sibs = o.ctx().shown(sel.parentId);
        o.ui.select({ parentId: sel.parentId, anchor: sibs[0]!, head: sibs.at(-1)! }, [...sibs]);
      }
      return handled();

    case "z":
      if (!mod) return;
      if (e.shiftKey) o.redo();
      else o.undo();
      return handled();

    case "y":
      if (!mod) return;
      o.redo();
      return handled();

    case "ArrowRight":
    case "]":
      if (key === "ArrowRight" ? !e.altKey : !mod) return;
      zoomIn(o, sel.head);
      return handled();

    case "ArrowLeft":
    case "[":
      if (key === "ArrowLeft" ? !e.altKey : !mod) return;
      zoomOut(o);
      return handled();
  }
}

/** Shift+Up/Down: grows or shrinks the block among siblings; past the end, the parent is selected. */
function extendSelection(o: Outliner, up: boolean): void {
  const sel = o.ui.selection!;
  const ctx = o.ctx();
  const sibs = ctx.shown(sel.parentId);
  const next = sibs.indexOf(sel.head) + (up ? -1 : 1);
  if (next >= 0 && next < sibs.length) {
    const head = sibs[next]!;
    const [a, b] = [sibs.indexOf(sel.anchor), next].sort((x, y) => x - y);
    o.ui.select({ parentId: sel.parentId, anchor: sel.anchor, head }, sibs.slice(a, b! + 1));
  } else if (sel.parentId !== null && sel.parentId !== ctx.root) {
    const parent = o.store.get(sel.parentId)!;
    o.ui.select({ parentId: parent.parentId, anchor: parent.id, head: parent.id }, [parent.id]);
  }
}
