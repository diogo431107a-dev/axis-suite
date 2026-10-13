// Text from Yggdrasil, Dynalist or Workflowy as Mimir's plain text: markup goes, links keep their
// address as "label (https://…)" so it stays clickable. Adapted from Yggdrasil's text/plain.ts.
import { isSafeUrl } from "./links.ts";

/** A link as plain text: its address, after its label if it has one. Relative links keep only the label. */
function linkText(label: string, url: string): string {
  if (!isSafeUrl(url)) return label;
  return label && label !== url ? `${label} (${url})` : url;
}

/** Markdown (Yggdrasil, Dynalist) as plain text. */
export function plainText(source: string): string {
  return source
    .replace(/!\[([^\]]*)\]\(([^)\s]*)\)/g, (_, label: string, url: string) => linkText(label, url))
    .replace(/\[([^\]]*)\]\(([^)\s]*)\)/g, (_, label: string, url: string) => linkText(label, url))
    .replace(/(\*\*|__|~~|`)(.+?)\1/g, "$2")
    .replace(/!\((\d{4}-\d{2}-\d{2})(?: \d{2}:\d{2})?\)/g, "$1")
    .trim();
}

/** Inline HTML (Workflowy) as plain text, links as "label (url)". Nothing in it runs or loads. */
export function htmlToPlain(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const walk = (node: globalThis.Node): string => {
    if (node.nodeType === globalThis.Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof Element)) return "";
    const inner = [...node.childNodes].map(walk).join("");
    const tag = node.tagName.toLowerCase();
    if (tag === "a") return linkText(inner, node.getAttribute("href") ?? "");
    if (tag === "br") return " ";
    return inner;
  };
  return walk(doc.body)
    .replace(/\s*\n\s*/g, " ")
    .trim();
}
