// OPML in and out, entirely in the browser (the server has no XML code). Adapted from Yggdrasil.
//   In:  <outline text>; markdown (Yggdrasil, Dynalist) and Workflowy's HTML become plain text.
//        Notes and completion marks have nowhere to go in a map: they are counted and dropped.
//   Out: OPML 2.0, one outline per node. Arrows can't be written in OPML.
import type { Draft } from "../model/commands.ts";
import { htmlToPlain, plainText } from "../text/plain.ts";
import { clip, type TextSource } from "./plaintext.ts";

export class OpmlError extends Error {}

/** What an OPML file held. */
export interface OpmlFile {
  title: string | null;
  drafts: Draft[];
  /** notes left out */
  notes: number;
  /** completion marks left out */
  completed: number;
}

/** Whether pasted text is OPML. */
export const looksLikeOpml = (text: string) => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<opml[\s>]/i.test(text);

// The inline HTML Workflowy writes in its text attributes, and the entities it escapes text with.
const HTML_TAG = /<\/?(b|strong|i|em|u|s|strike|del|code|a|span|mention|time|br)\b[^>]*>/i;
const HTML_ENTITY = /&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/i;

const truthy = (v: string | null) => v !== null && /^(true|1|yes)$/i.test(v.trim());
const outlines = (el: Element) => [...el.children].filter((c) => c.tagName.toLowerCase() === "outline");

/** Reads an OPML document, without recursion. Throws OpmlError if it isn't one. */
export function parseOpml(xml: string): OpmlFile {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) throw new OpmlError("This file isn’t valid XML.");
  const root = doc.documentElement;
  if (root.tagName.toLowerCase() !== "opml") throw new OpmlError("This file isn’t OPML.");
  const body = [...root.children].find((c) => c.tagName.toLowerCase() === "body");
  if (!body) throw new OpmlError("This OPML file has no outline.");
  const title = root.querySelector("head > title")?.textContent?.trim() || null;

  const file: OpmlFile = { title, drafts: [], notes: 0, completed: 0 };
  const stack: { el: Element; into: Draft[] }[] = outlines(body)
    .map((el) => ({ el, into: file.drafts }))
    .reverse();
  while (stack.length > 0) {
    const { el, into } = stack.pop()!;
    const raw = (el.getAttribute("text") ?? el.getAttribute("title") ?? "").replace(/\r\n?/g, "\n");
    const html = HTML_TAG.test(raw) || HTML_ENTITY.test(raw);
    const draft: Draft = { text: clip(html ? htmlToPlain(raw) : plainText(raw)), children: [] };
    if (el.getAttribute("_note")) file.notes++;
    if (truthy(el.getAttribute("complete")) || truthy(el.getAttribute("_complete"))) file.completed++;
    into.push(draft);
    const kids = outlines(el);
    for (let i = kids.length - 1; i >= 0; i--) stack.push({ el: kids[i]!, into: draft.children });
  }
  return file;
}

const escapeAttr = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "&#10;")
    .replace(/\t/g, "&#9;");

/** A branch (the node and everything under it) as an OPML 2.0 document. */
export function toOpml(tree: TextSource, id: string, title: string): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    "  <head>",
    `    <title>${escapeAttr(title)}</title>`,
    "  </head>",
    "  <body>",
  ];
  // Each node opens its outline; a marker closes it once its children are written.
  const stack: ({ id: string; depth: number } | { close: string })[] = [{ id, depth: 2 }];
  while (stack.length > 0) {
    const item = stack.pop()!;
    if ("close" in item) {
      lines.push(item.close);
      continue;
    }
    const pad = "  ".repeat(item.depth);
    const attrs = `text="${escapeAttr(tree.text(item.id))}"`;
    const kids = tree.children(item.id);
    if (kids.length === 0) {
      lines.push(`${pad}<outline ${attrs}/>`);
      continue;
    }
    lines.push(`${pad}<outline ${attrs}>`);
    stack.push({ close: `${pad}</outline>` });
    for (let i = kids.length - 1; i >= 0; i--) stack.push({ id: kids[i]!, depth: item.depth + 1 });
  }
  lines.push("  </body>", "</opml>", "");
  return lines.join("\n");
}
