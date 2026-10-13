import { describe, expect, it } from "vitest";
import { datesOf, fileMarkup, isSafeUrl, tagsOf, tokenize } from "./inline.ts";

describe("tokenize", () => {
  it("keeps plain text as one run", () => {
    expect(tokenize("just words")).toEqual([{ type: "text", start: 0, text: "just words" }]);
  });

  it("reads bold, italic, strike and code, with source offsets", () => {
    expect(tokenize("a **b** __c__ ~~d~~ `e`")).toEqual([
      { type: "text", start: 0, text: "a " },
      { type: "bold", start: 2, end: 7, children: [{ type: "text", start: 4, text: "b" }] },
      { type: "text", start: 7, text: " " },
      { type: "italic", start: 8, end: 13, children: [{ type: "text", start: 10, text: "c" }] },
      { type: "text", start: 13, text: " " },
      { type: "strike", start: 14, end: 19, children: [{ type: "text", start: 16, text: "d" }] },
      { type: "text", start: 19, text: " " },
      { type: "code", start: 20, end: 23, text: "e", textStart: 21 },
    ]);
  });

  it("nests formatting, but not inside code", () => {
    expect(tokenize("**x __y__**")).toEqual([
      {
        type: "bold",
        start: 0,
        end: 11,
        children: [
          { type: "text", start: 2, text: "x " },
          { type: "italic", start: 4, end: 9, children: [{ type: "text", start: 6, text: "y" }] },
        ],
      },
    ]);
    expect(tokenize("`**not bold**`")).toEqual([
      { type: "code", start: 0, end: 14, text: "**not bold**", textStart: 1 },
    ]);
  });

  it("leaves unclosed markers as text", () => {
    expect(tokenize("2 ** 3 and `x")).toEqual([{ type: "text", start: 0, text: "2 ** 3 and `x" }]);
  });

  it("reads links and bare URLs, without trailing punctuation", () => {
    expect(tokenize("[Docs](https://example.com/a) see https://x.org/p?q=1.")).toEqual([
      { type: "link", start: 0, end: 29, text: "Docs", textStart: 1, url: "https://example.com/a" },
      { type: "text", start: 29, text: " see " },
      { type: "url", start: 34, end: 53, url: "https://x.org/p?q=1" },
      { type: "text", start: 53, text: "." },
    ]);
  });

  it("never makes javascript: (or other) links", () => {
    const tokens = tokenize("[click](javascript:alert(1))");
    expect(tokens.every((t) => t.type === "text")).toBe(true);
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("JaVaScRiPt:alert(1)")).toBe(false);
    expect(isSafeUrl("data:text/html,x")).toBe(false);
    expect(isSafeUrl("mailto:a@b.c")).toBe(true);
  });

  it("reads tags and mentions, but not emails or words", () => {
    expect(tokenize("#todo for @freya, mail a@b.com, issue#4")).toEqual([
      { type: "tag", start: 0, end: 5, text: "#todo", name: "todo" },
      { type: "text", start: 5, text: " for " },
      { type: "mention", start: 10, end: 16, text: "@freya", name: "freya" },
      { type: "text", start: 16, text: ", mail a@b.com, issue#4" },
    ]);
    expect(tagsOf("#Work/Q4. and #ÉTÉ")).toEqual(["work/q4", "été"]);
  });

  it("reads dates with and without a time", () => {
    expect(tokenize("due !(2026-10-11) and !(2026-12-24 18:30)")).toEqual([
      { type: "text", start: 0, text: "due " },
      { type: "date", start: 4, end: 17, date: "2026-10-11", time: null },
      { type: "text", start: 17, text: " and " },
      { type: "date", start: 22, end: 41, date: "2026-12-24", time: "18:30" },
    ]);
    expect(datesOf("**!(2026-01-02)**")).toEqual([{ date: "2026-01-02", time: null }]);
    expect(tokenize("!(2026-1-2)")[0]!.type).toBe("text");
  });

  it("reads uploaded images and files, and only Yggdrasil's own", () => {
    const url = "/api/files/0f8fad5b-d9cb-469f-a165-70867728950e";
    expect(tokenize(`see ![cat.png](${url}) and [plan.pdf](${url})`)).toEqual([
      { type: "text", start: 0, text: "see " },
      { type: "image", start: 4, end: 63, alt: "cat.png", url },
      { type: "text", start: 63, text: " and " },
      { type: "file", start: 68, end: 127, name: "plan.pdf", url },
    ]);
    // Other images stay links; other relative addresses aren't links at all.
    expect(tokenize("![x](https://e.com/a.png)").map((t) => t.type)).toEqual(["text", "link"]);
    expect(tokenize(`[x](${url}/../../me)`).map((t) => t.type)).toEqual(["text"]);
    expect(isSafeUrl(url)).toBe(true);
    expect(isSafeUrl("/api/tree")).toBe(false);
  });

  it("writes markup for a file whatever its name", () => {
    const url = "/api/files/0f8fad5b-d9cb-469f-a165-70867728950e";
    expect(fileMarkup("a [draft]\n.png", url, true)).toBe(`![a (draft) .png](${url})`);
    expect(fileMarkup("", url, false)).toBe(`[file](${url})`);
    expect(tokenize(fileMarkup("a [b].pdf", url, false))[0]!.type).toBe("file");
  });
});
