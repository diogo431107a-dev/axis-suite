// Branches as text, for the clipboard: "- " lines indented by 2 spaces per level, as Yggdrasil
// copies its bullets, so a branch copied here pastes there and back. A node's further lines go
// under it, indented without a marker (Yggdrasil reads them as its note). Pasted text is read
// back into a tree by its indentation. Adapted from Yggdrasil's io/plaintext.ts.
import { LIMITS } from "../../shared/protocol.ts";
import type { Draft } from "../model/commands.ts";
import { plainText } from "../text/plain.ts";

/** The map as copying sees it: live children, folded or not. */
export interface TextSource {
  text(id: string): string;
  children(id: string): readonly string[];
}

/** A branch (the node and everything under it) as indented "- " lines. */
export function toPlainText(tree: TextSource, id: string): string {
  const lines: string[] = [];
  const stack: { id: string; depth: number }[] = [{ id, depth: 0 }];
  while (stack.length > 0) {
    const { id: cur, depth } = stack.pop()!;
    const pad = "  ".repeat(depth);
    const [first, ...more] = tree.text(cur).split("\n");
    lines.push(`${pad}- ${first}`);
    for (const l of more) lines.push(`${pad}  ${l}`);
    const kids = tree.children(cur);
    for (let i = kids.length - 1; i >= 0; i--) stack.push({ id: kids[i]!, depth: depth + 1 });
  }
  return lines.join("\n");
}

// "- ", "* ", "+ ", "• " or "1. ", then an optional Markdown task box.
const MARKER = /^(?:[-*+•]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;

/** A node's text, cut to the limit. */
export const clip = (text: string) => (text.length > LIMITS.textChars ? text.slice(0, LIMITS.textChars) : text);

/**
 * Reads indented lines as a tree. When some lines have bullet markers, a line without one that is
 * indented under a bullet is a further line of that bullet's text; otherwise every line is a node.
 * Markdown becomes plain text.
 */
export function parsePlainText(text: string): Draft[] {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((raw) => {
      const expanded = raw.replace(/\t/g, "    ");
      const body = expanded.trimStart();
      return { indent: expanded.length - body.length, body: body.trimEnd() };
    })
    .filter((l) => l.body !== "");
  const anyMarkers = lines.some((l) => MARKER.test(l.body));

  const roots: Draft[] = [];
  const stack: { indent: number; draft: Draft }[] = [];
  for (const { indent, body } of lines) {
    const match = MARKER.exec(body);
    const last = stack.at(-1);
    if (anyMarkers && !match && last && indent > last.indent) {
      last.draft.text = clip(`${last.draft.text}\n${plainText(body)}`);
      continue;
    }
    const draft: Draft = { text: clip(plainText(match ? body.slice(match[0].length) : body)), children: [] };
    while (stack.length > 0 && stack.at(-1)!.indent >= indent) stack.pop();
    (stack.at(-1)?.draft.children ?? roots).push(draft);
    stack.push({ indent, draft });
  }
  return roots;
}
