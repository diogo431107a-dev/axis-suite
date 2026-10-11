import { describe, expect, it } from "vitest";
import type { Node } from "../../shared/protocol.ts";
import { newNode } from "../model/store.ts";
import { parsePlainText, toHtml, toIndentedText, toMarkdown, toPlainText } from "./plaintext.ts";

function source(nodes: (Partial<Node> & { id: string })[]) {
  const byId = new Map(nodes.map((n) => [n.id, { ...newNode(n.id, null, "a0"), ...n }]));
  return {
    get: (id: string) => byId.get(id),
    children: (id: string) => nodes.filter((n) => n.parentId === id).map((n) => n.id),
  };
}

describe("toPlainText and toHtml", () => {
  const tree = source([
    { id: "a", content: "Groceries", note: "for Sunday\nbefore noon" },
    { id: "b", parentId: "a", content: "Milk" },
    { id: "c", parentId: "b", content: "Oat <or> soy" },
    { id: "d", content: "Call mum" },
  ]);

  it("writes indented bullets with notes under them", () => {
    expect(toPlainText(tree, ["a", "d"])).toBe(
      ["- Groceries", "  for Sunday", "  before noon", "  - Milk", "    - Oat <or> soy", "- Call mum"].join("\n"),
    );
  });

  it("writes nested lists, escaped", () => {
    expect(toHtml(tree, ["b"])).toBe("<ul><li>Milk<ul><li>Oat &lt;or&gt; soy</li></ul></li></ul>");
  });

  it("exports Markdown and plain indented text", () => {
    const done = source([
      { id: "a", content: "**Plan**", note: "two\nlines" },
      { id: "b", parentId: "a", content: "Shipped", completedAt: "2026-10-01T00:00:00.000Z" },
    ]);
    expect(toMarkdown(done, ["a"])).toBe("- **Plan**\n  two\n  lines\n  - ~~Shipped~~\n");
    expect(toIndentedText(done, ["a"])).toBe('Plan\n  "two\n  lines"\n  Shipped\n');
  });

  it("reads back what it writes", () => {
    const text = toPlainText(tree, ["a", "d"]);
    expect(parsePlainText(text)).toEqual([
      {
        content: "Groceries",
        note: "for Sunday\nbefore noon",
        children: [{ content: "Milk", children: [{ content: "Oat <or> soy", children: [] }] }],
      },
      { content: "Call mum", children: [] },
    ]);
  });
});

describe("parsePlainText", () => {
  it("nests by indentation, with tabs or spaces, and skips blank lines", () => {
    expect(parsePlainText("One\n\tTwo\n\t\tThree\n\n    Four\nFive")).toEqual([
      {
        content: "One",
        children: [
          { content: "Two", children: [{ content: "Three", children: [] }] },
          { content: "Four", children: [] },
        ],
      },
      { content: "Five", children: [] },
    ]);
  });

  it("understands other bullet markers and Markdown tasks", () => {
    expect(parsePlainText("* a\r\n  + b\r\n1. c\n- [x] done\n- [ ] open")).toEqual([
      { content: "a", children: [{ content: "b", children: [] }] },
      { content: "c", children: [] },
      { content: "done", completed: true, children: [] },
      { content: "open", children: [] },
    ]);
  });

  it("treats every line as a bullet when none has a marker", () => {
    expect(parsePlainText("a\n  b")).toEqual([{ content: "a", children: [{ content: "b", children: [] }] }]);
  });

  it("copes with a first line indented more than the rest", () => {
    expect(parsePlainText("    - deep\n- shallow")).toEqual([
      { content: "deep", children: [] },
      { content: "shallow", children: [] },
    ]);
  });
});
