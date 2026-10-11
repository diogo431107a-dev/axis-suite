// The one textarea: the bullet being edited shows its raw text here, every other bullet shows
// formatted text. It grows with its content, so it looks like the text it replaces.
import { useLayoutEffect, useRef } from "react";
import { parsePlainText } from "../io/plaintext.ts";
import * as cmd from "../model/commands.ts";
import type { Field } from "../model/ui.ts";
import type { Focus } from "../model/undo.ts";
import { useCaret, useNode, useOutliner } from "./hooks.ts";
import { editorKeyDown } from "./keymap.ts";

function autoGrow(ta: HTMLTextAreaElement | null): void {
  if (!ta) return;
  ta.style.height = "0px";
  ta.style.height = `${ta.scrollHeight}px`;
}

interface Props {
  id: string;
  field: Field;
  className?: string;
  placeholder?: string;
}

export function Editor({ id, field, className = "", placeholder }: Props) {
  const o = useOutliner();
  const node = useNode(id);
  const caret = useCaret(id);
  const ref = useRef<HTMLTextAreaElement>(null);
  // The selection before the latest change, for undo.
  const selection = useRef({ start: 0, end: 0 });
  const value = node?.[field] ?? "";

  // Puts the caret where it was asked for: on mount, and whenever it is moved from outside.
  useLayoutEffect(() => {
    const ta = ref.current;
    const c = o.ui.caret;
    if (!ta || !c || c.id !== id) return;
    autoGrow(ta);
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(c.start, c.end);
    selection.current = { start: c.start, end: c.end };
    ta.scrollIntoView({ block: "nearest" });
  }, [caret?.seq, o, id]);

  useLayoutEffect(() => autoGrow(ref.current), [value]);

  const focusAt = (start: number, end: number): Focus => ({ kind: "caret", id, field, start, end });

  /** Saves the textarea's text as the field's new value. */
  const save = (ta: HTMLTextAreaElement) => {
    const before = focusAt(selection.current.start, selection.current.end);
    selection.current = { start: ta.selectionStart, end: ta.selectionEnd };
    // The bullet's text is one line: Enter splits it, and pasted lines become bullets.
    const next = field === "content" ? ta.value.replace(/\r?\n/g, " ") : ta.value;
    o.type(id, field, next, before, focusAt(ta.selectionStart, ta.selectionEnd));
  };

  return (
    <textarea
      ref={ref}
      data-editor={id}
      rows={1}
      value={value}
      placeholder={placeholder}
      spellCheck
      className={`ygg-text block w-full resize-none overflow-hidden bg-transparent outline-none ${className}`}
      onChange={(e) => save(e.currentTarget)}
      onSelect={(e) => {
        const ta = e.currentTarget;
        selection.current = { start: ta.selectionStart, end: ta.selectionEnd };
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        editorKeyDown(o, e, e.currentTarget, id, field);
      }}
      onPaste={(e) => {
        if (field !== "content") return;
        const text = e.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
        const trimmed = text.replace(/\n+$/, "");
        e.preventDefault();
        if (!trimmed.includes("\n")) {
          // One line: inserted as text, without the line break a copied line often ends with.
          const ta = e.currentTarget;
          ta.setRangeText(trimmed, ta.selectionStart, ta.selectionEnd, "end");
          save(ta);
          return;
        }
        o.run((ctx) => cmd.pasteDrafts(ctx, id, parsePlainText(trimmed)));
      }}
      onBlur={() => {
        // Clicking elsewhere on the page ends editing; switching to another window doesn't.
        setTimeout(() => {
          if (!document.hasFocus()) return;
          const c = o.ui.caret;
          if (c?.id === id && c.field === field && document.activeElement !== ref.current) {
            o.history.seal();
            o.ui.clearCaret(id);
          }
        }, 0);
      }}
    />
  );
}
