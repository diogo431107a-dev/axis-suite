// Bullets as text, for the clipboard: "- " bullets indented by 2 spaces per level, notes as
// lines indented under their bullet, and the same as nested <ul> HTML. Pasted text is read back
// into a tree by its indentation.
import type { Node } from "../../shared/protocol.ts";
import type { Draft } from "../model/commands.ts";
import { plainText } from "../text/plain.ts";

export interface TextSource {
  get(id: string): Node | undefined;
  /** The children to include, in order (null: the top level). */
  children(id: string | null): readonly string[];
}

/** Each bullet as `line(node)`, two spaces deeper per level, its note's lines under it. */
function writeLines(
  tree: TextSource,
  ids: readonly string[],
  line: (node: Node) => string,
  note: (text: string) => string = (text) => text,
): string {
  const lines: string[] = [];
  const walk = (id: string, depth: number) => {
    const node = tree.get(id);
    if (!node) return;
    const pad = "  ".repeat(depth);
    lines.push(pad + line(node));
    if (node.note) for (const l of note(node.note).split("\n")) lines.push(`${pad}  ${l}`);
    for (const kid of tree.children(id)) walk(kid, depth + 1);
  };
  for (const id of ids) walk(id, 0);
  return lines.join("\n");
}

/** The bullets and everything under them as indented "- " lines, as the clipboard gets them. */
export function toPlainText(tree: TextSource, ids: readonly string[]): string {
  return writeLines(tree, ids, (n) => `- ${n.content}`);
}

/** For export as Markdown: a nested list, completed bullets struck through. */
export function toMarkdown(tree: TextSource, ids: readonly string[]): string {
  return `${writeLines(tree, ids, (n) => `- ${n.completedAt && n.content ? `~~${n.content}~~` : n.content}`)}\n`;
}

/** For export as plain text: indented lines without markup, notes in quotes. */
export function toIndentedText(tree: TextSource, ids: readonly string[]): string {
  return `${writeLines(
    tree,
    ids,
    (n) => plainText(n.content),
    (text) => `"${text}"`,
  )}\n`;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The same as nested lists, for pasting into documents and mail. */
export function toHtml(tree: TextSource, ids: readonly string[]): string {
  const list = (items: readonly string[]): string => {
    const lis = items.map((id) => {
      const node = tree.get(id);
      if (!node) return "";
      const note = node.note ? `<br><small>${escapeHtml(node.note).replace(/\n/g, "<br>")}</small>` : "";
      const kids = tree.children(id);
      return `<li>${escapeHtml(node.content)}${note}${kids.length > 0 ? list(kids) : ""}</li>`;
    });
    return `<ul>${lis.join("")}</ul>`;
  };
  return list(ids);
}

// "- ", "* ", "+ ", "• " or "1. ", then an optional Markdown task box.
const MARKER = /^(?:[-*+•]|\d+[.)])\s+(?:\[([ xX])\]\s+)?/;

/**
 * Reads indented lines as a tree. When some lines have bullet markers, a line without one that
 * is indented under a bullet belongs to that bullet's note; otherwise every line is a bullet.
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
      last.draft.note = last.draft.note ? `${last.draft.note}\n${body}` : body;
      continue;
    }
    const draft: Draft = { content: match ? body.slice(match[0].length) : body, children: [] };
    if (match?.[1] && match[1] !== " ") draft.completed = true;
    while (stack.length > 0 && stack.at(-1)!.indent >= indent) stack.pop();
    (stack.at(-1)?.draft.children ?? roots).push(draft);
    stack.push({ indent, draft });
  }
  return roots;
}
