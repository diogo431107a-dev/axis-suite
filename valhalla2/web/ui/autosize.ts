// A text box that grows with what is in it, so a long profile reads whole instead of in a slot.
import { useLayoutEffect, useRef } from "react";

/** The box's nearest ancestor that scrolls, whose place is kept while the box is measured. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  for (let at = element.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (overflowY === "auto" || overflowY === "scroll") return at;
  }
  return null;
}

/**
 * A ref for a textarea that fits its height to its text. Its CSS min-height is the floor. It fits
 * again when the text changes, when the window is resized, and when a fold around it opens (a
 * closed fold has no height to measure).
 */
export function useAutosize(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const fit = () => {
      if (box.offsetParent === null) return;
      const scroller = scrollerOf(box);
      const top = scroller?.scrollTop ?? 0;
      box.style.height = "auto";
      box.style.height = `${box.scrollHeight + 2}px`;
      if (scroller) scroller.scrollTop = top;
    };
    fit();
    const folds: HTMLDetailsElement[] = [];
    for (let at = box.closest("details"); at; at = at.parentElement?.closest("details") ?? null) folds.push(at);
    for (const fold of folds) fold.addEventListener("toggle", fit);
    window.addEventListener("resize", fit);
    return () => {
      for (const fold of folds) fold.removeEventListener("toggle", fit);
      window.removeEventListener("resize", fit);
    };
  }, [value]);
  return ref;
}
