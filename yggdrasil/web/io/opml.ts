// OPML in and out, entirely in the browser (the server has no XML code).
//   In:  <outline text _note complete|_complete>; Workflowy's HTML in text becomes markdown.
//   Out: OPML 2.0 with text, _note and complete, which Dynalist and Workflowy both read.
import type { Draft } from "../model/commands.ts";
import { isSafeUrl } from "../text/inline.ts";
import type { TextSource } from "./plaintext.ts";

export class OpmlError extends Error {}

/** Whether pasted or dropped text is OPML. */
export const looksLikeOpml = (text: string) => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<opml[\s>]/i.test(text);

// The inline HTML Workflowy writes in its text attributes, and the entities it escapes text with.
const HTML_TAG = /<\/?(b|strong|i|em|u|s|strike|del|code|a|span|mention|time|br)\b[^>]*>/i;
const HTML_ENTITY = /&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/i;

/** Workflowy's inline HTML as markdown. Only known tags carry over; anything else becomes plain text. */
export function htmlToMarkdown(html: string): string {
  // An inert document: nothing in it runs or loads.
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const walk = (node: globalThis.Node): string => {
    if (node.nodeType === globalThis.Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof Element)) return "";
    const inner = [...node.childNodes].map(walk).join("");
    switch (node.tagName.toLowerCase()) {
      case "b":
      case "strong":
        return inner.trim() ? `**${inner}**` : inner;
      case "i":
      case "em":
        return inner.trim() ? `__${inner}__` : inner;
      case "s":
      case "strike":
      case "del":
        return inner.trim() ? `~~${inner}~~` : inner;
      case "code":
        return inner ? `\`${inner}\`` : inner;
      case "a": {
        const href = node.getAttribute("href") ?? "";
        if (!isSafeUrl(href)) return inner;
        return inner && inner !== href ? `[${inner}](${href})` : href;
      }
      case "br":
        return " ";
      default:
        return inner;
    }
  };
  return walk(doc.body).replace(/\s*\n\s*/g, " ");
}

const truthy = (v: string | null) => v !== null && /^(true|1|yes)$/i.test(v.trim());
const outlines = (el: Element) => [...el.children].filter((c) => c.tagName.toLowerCase() === "outline");

/**
 * Dynalist writes markdown in text; Workflowy (and others) write HTML. Without a Dynalist
 * marker, text with HTML tags or entities in it is read as HTML.
 */
function draftOf(el: Element, markdown: boolean): Draft {
  const text = el.getAttribute("text") ?? el.getAttribute("title") ?? "";
  const html = !markdown && (HTML_TAG.test(text) || HTML_ENTITY.test(text));
  const draft: Draft = {
    content: (html ? htmlToMarkdown(text) : text).replace(/\r?\n/g, " "),
    children: outlines(el).map((c) => draftOf(c, markdown)),
  };
  const note = el.getAttribute("_note");
  if (note) draft.note = note.replace(/\r\n?/g, "\n");
  if (truthy(el.getAttribute("complete")) || truthy(el.getAttribute("_complete"))) draft.completed = true;
  return draft;
}

/** Reads an OPML document. Throws OpmlError if it isn't one. */
export function parseOpml(xml: string): { title: string | null; drafts: Draft[] } {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) throw new OpmlError("This file isn’t valid XML.");
  const root = doc.documentElement;
  if (root.tagName.toLowerCase() !== "opml") throw new OpmlError("This file isn’t OPML.");
  const body = [...root.children].find((c) => c.tagName.toLowerCase() === "body");
  if (!body) throw new OpmlError("This OPML file has no outline.");
  const title = root.querySelector("head > title")?.textContent?.trim() || null;
  const markdown = root.querySelector("head > flavor")?.textContent?.trim().toLowerCase() === "dynalist";
  return { title, drafts: outlines(body).map((c) => draftOf(c, markdown)) };
}

const escapeAttr = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "&#10;")
    .replace(/\t/g, "&#9;");

/** The bullets and everything under them as an OPML 2.0 document. */
export function toOpml(tree: TextSource, ids: readonly string[], title: string): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    "  <head>",
    `    <title>${escapeAttr(title)}</title>`,
    "  </head>",
    "  <body>",
  ];
  const walk = (id: string, depth: number) => {
    const node = tree.get(id);
    if (!node) return;
    const pad = "  ".repeat(depth);
    let attrs = `text="${escapeAttr(node.content)}"`;
    if (node.note) attrs += ` _note="${escapeAttr(node.note)}"`;
    if (node.completedAt) attrs += ' complete="true"';
    const kids = tree.children(id);
    if (kids.length === 0) {
      lines.push(`${pad}<outline ${attrs}/>`);
      return;
    }
    lines.push(`${pad}<outline ${attrs}>`);
    for (const kid of kids) walk(kid, depth + 1);
    lines.push(`${pad}</outline>`);
  };
  for (const id of ids) walk(id, 2);
  lines.push("  </body>", "</opml>", "");
  return lines.join("\n");
}

/** How many bullets drafts hold, subtrees included. */
export function countDrafts(drafts: readonly Draft[]): number {
  return drafts.reduce((n, d) => n + 1 + countDrafts(d.children), 0);
}
