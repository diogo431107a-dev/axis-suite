// Editing a node's text in place: a textarea laid over the node, in the node's font and size, that
// moves and zooms with the map. The map grows the node as the text grows. Enter saves, Shift+Enter
// starts a new line, Tab saves and adds a child, Ctrl+Enter saves and adds a node below, Esc
// leaves the text as it was. Leaving the field saves too.
import { useLayoutEffect, useRef } from "react";
import { LIMITS } from "../../shared/protocol.ts";
import type { Box } from "../layout/layout.ts";
import { COLORS, FONT_STACK, styleOf } from "../layout/theme.ts";
import type { View } from "./view.ts";

/** How editing ended. */
export type EditEnd = "save" | "child" | "sibling" | "cancel" | "blur";

interface EditorProps {
  box: Box;
  text: string;
  view: View;
  onChange: (text: string) => void;
  onEnd: (how: EditEnd) => void;
}

export function Editor({ box, text, view, onChange, onEnd }: EditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const style = styleOf(box.level);

  useLayoutEffect(() => {
    const el = ref.current!;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // Follow the map as it pans and zooms, and the node as it moves.
  useLayoutEffect(() => {
    const el = ref.current!;
    return view.attach(el, (s) => {
      el.style.transform = `translate(${s.tx + box.x * s.k}px, ${s.ty + box.y * s.k}px) scale(${s.k})`;
    });
  }, [view, box.x, box.y]);

  const root = box.level === 0;
  return (
    <textarea
      ref={ref}
      value={text}
      maxLength={LIMITS.textChars}
      aria-label="The node's text"
      spellCheck
      rows={1}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onEnd("blur")}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        // Keys that pick a character in an input method (Chinese, Japanese, …) are the method's.
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        const mod = e.ctrlKey || e.metaKey;
        if (e.key === "Enter" && mod) {
          e.preventDefault();
          onEnd("sibling");
        } else if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
          e.preventDefault();
          onEnd("save");
        } else if (e.key === "Tab") {
          e.preventDefault();
          if (!e.shiftKey) onEnd("child");
        } else if (e.key === "Escape") {
          e.preventDefault();
          onEnd("cancel");
        }
      }}
      className="absolute top-0 left-0 m-0 resize-none overflow-hidden border-0 outline-none"
      style={{
        transformOrigin: "0 0",
        width: box.w,
        height: box.h,
        padding: `${style.padY}px ${style.padX}px`,
        font: `${style.weight} ${style.size}px/${style.lineHeight}px ${FONT_STACK}`,
        textAlign: root ? "center" : "left",
        color: root ? COLORS.rootText : COLORS.text,
        background: root ? COLORS.rootFill : "#ffffff",
        borderRadius: style.radius,
        boxShadow: `0 0 0 2px ${COLORS.select}`,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
      }}
    />
  );
}

interface LabelEditorProps {
  /** where the label goes, in map coordinates */
  at: { x: number; y: number };
  text: string;
  view: View;
  onEnd: (text: string | null) => void;
}

/** Editing an arrow's label: a small field over the arrow's middle. Enter saves, Esc doesn't. */
export function LabelEditor({ at, text, view, onEnd }: LabelEditorProps) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const end = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onEnd(value);
  };

  useLayoutEffect(() => {
    const el = ref.current!;
    el.focus({ preventScroll: true });
    el.select();
    return view.attach(el, (s) => {
      el.style.transform = `translate(${s.tx + at.x * s.k}px, ${s.ty + at.y * s.k}px) translate(-50%, -50%)`;
    });
  }, [view, at.x, at.y]);

  return (
    <input
      ref={ref}
      defaultValue={text}
      maxLength={LIMITS.labelChars}
      aria-label="The arrow's label"
      placeholder="Label"
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => end(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter") {
          e.preventDefault();
          end(e.currentTarget.value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          end(null);
        }
      }}
      className="absolute top-0 left-0 w-48 rounded-full border border-fuchsia-400 bg-white px-3 py-1 text-center text-xs text-stone-700 shadow outline-none"
    />
  );
}
