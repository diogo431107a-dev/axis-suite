// Ctrl+B, Ctrl+I and Ctrl+K in the editor: markup put around (or taken off) the selection.

export interface Edit {
  value: string;
  start: number;
  end: number;
}

/**
 * Wraps value[start..end] in `before` and `after`, keeping it selected. If it is already wrapped
 * in them, the markers come off instead. With nothing selected, the caret ends up between them.
 */
export function toggleWrap(value: string, start: number, end: number, before: string, after = before): Edit {
  const inner = value.slice(start, end);
  if (value.slice(start - before.length, start) === before && value.slice(end, end + after.length) === after) {
    return {
      value: value.slice(0, start - before.length) + inner + value.slice(end + after.length),
      start: start - before.length,
      end: end - before.length,
    };
  }
  if (inner.startsWith(before) && inner.endsWith(after) && inner.length >= before.length + after.length) {
    const unwrapped = inner.slice(before.length, inner.length - after.length);
    return { value: value.slice(0, start) + unwrapped + value.slice(end), start, end: start + unwrapped.length };
  }
  return {
    value: value.slice(0, start) + before + inner + after + value.slice(end),
    start: start + before.length,
    end: end + before.length,
  };
}

/**
 * Turns the selection into a link: [text](url). A selected URL becomes the address; otherwise
 * the selection is the text, and the address placeholder is selected so typing replaces it.
 * With nothing selected, an empty []() goes in with the caret inside the brackets.
 */
export function makeLink(value: string, start: number, end: number): Edit {
  const inner = value.slice(start, end);
  if (!inner) return { value: `${value.slice(0, start)}[]()${value.slice(end)}`, start: start + 1, end: start + 1 };
  if (/^(https?:\/\/|mailto:)\S+$/i.test(inner)) {
    const head = value.slice(0, start) + "[";
    return { value: `${head}](${inner})${value.slice(end)}`, start: head.length, end: head.length };
  }
  const head = `${value.slice(0, start)}[${inner}](`;
  const placeholder = "https://";
  return {
    value: `${head}${placeholder})${value.slice(end)}`,
    start: head.length,
    end: head.length + placeholder.length,
  };
}
