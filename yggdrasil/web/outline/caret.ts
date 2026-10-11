// Caret geometry. A textarea can't say where its caret is on screen, so a hidden "mirror" div
// with the same styles and text is measured instead. Rendered (not edited) text maps a point
// back to an offset in the bullet's source text through data-offset attributes on its spans.

const COPIED_STYLES = [
  "boxSizing",
  "width",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "lineHeight",
  "textTransform",
  "wordSpacing",
  "tabSize",
] as const;

let mirror: HTMLDivElement | null = null;

/** Where the caret at `pos` would be, relative to the textarea's top-left corner. */
export function caretPosition(ta: HTMLTextAreaElement, pos: number): { top: number; left: number } {
  mirror ??= document.body.appendChild(document.createElement("div"));
  const style = getComputedStyle(ta);
  for (const name of COPIED_STYLES) mirror.style[name] = style[name];
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.top = "0";
  mirror.style.left = "-9999px";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "anywhere";
  mirror.textContent = ta.value.slice(0, pos);
  const marker = document.createElement("span");
  // Something to measure even at the end of the text or a line.
  marker.textContent = ta.value.slice(pos) || ".";
  mirror.appendChild(marker);
  return { top: marker.offsetTop, left: marker.offsetLeft };
}

/** Whether the caret is on the textarea's first visual line. */
export function onFirstLine(ta: HTMLTextAreaElement): boolean {
  return caretPosition(ta, ta.selectionStart).top === caretPosition(ta, 0).top;
}

/** Whether the caret is on the textarea's last visual line. */
export function onLastLine(ta: HTMLTextAreaElement): boolean {
  return caretPosition(ta, ta.selectionEnd).top === caretPosition(ta, ta.value.length).top;
}

/** The caret's x position on screen. */
export function caretClientX(ta: HTMLTextAreaElement): number {
  return ta.getBoundingClientRect().left + caretPosition(ta, ta.selectionStart).left;
}

interface CaretPoint {
  node: globalThis.Node;
  offset: number;
}

function caretFromPoint(x: number, y: number): CaretPoint | null {
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    return pos ? { node: pos.offsetNode, offset: pos.offset } : null;
  }
  // Safari before 18.4.
  const range = (
    document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
  ).caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

/**
 * The offset in the source text under a point inside rendered text `root`. Text that maps
 * character for character to the source sits in an element with data-offset (its first
 * character's offset); other elements (a date shown as "Today") have data-end instead, and
 * any point in them maps there.
 */
export function sourceOffsetAt(root: HTMLElement, x: number, y: number, sourceLength: number): number | null {
  const hit = caretFromPoint(x, y);
  if (!hit || !root.contains(hit.node)) return null;
  const el = hit.node instanceof HTMLElement ? hit.node : hit.node.parentElement;
  const mapped = el?.closest<HTMLElement>("[data-offset],[data-end]");
  if (!mapped || !root.contains(mapped)) return hit.node === root ? sourceLength : null;
  if (mapped.dataset.end !== undefined) return Number(mapped.dataset.end);
  // Within a mapped element, count the characters of the text nodes before the hit.
  let offset = Number(mapped.dataset.offset);
  if (hit.node.nodeType === globalThis.Node.TEXT_NODE) {
    const walker = document.createTreeWalker(mapped, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t && t !== hit.node; t = walker.nextNode()) offset += t.textContent?.length ?? 0;
    offset += hit.offset;
  }
  return Math.min(offset, sourceLength);
}

/** The offset under x on the first or last line of rendered text `root`. */
export function sourceOffsetOnLine(root: HTMLElement, x: number, line: "first" | "last", sourceLength: number): number {
  const rect = root.getBoundingClientRect();
  const lineHeight = parseFloat(getComputedStyle(root).lineHeight) || 20;
  const y = line === "first" ? rect.top + lineHeight / 2 : rect.bottom - lineHeight / 2;
  const clampedX = Math.min(Math.max(x, rect.left + 1), rect.right - 1);
  return sourceOffsetAt(root, clampedX, y, sourceLength) ?? (line === "first" ? 0 : sourceLength);
}
