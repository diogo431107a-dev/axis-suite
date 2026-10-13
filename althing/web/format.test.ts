import { describe, expect, it } from "vitest";
import { linkify } from "./format.ts";
import { keyOf, pathOf } from "./nav.ts";

describe("linkify", () => {
  it("finds links, leaving out a sentence's final punctuation", () => {
    expect(linkify("see https://example.com/a?b=1. ok")).toEqual([
      { text: "see " },
      { text: "https://example.com/a?b=1", href: "https://example.com/a?b=1" },
      { text: ". ok" },
    ]);
  });

  it("leaves other schemes alone", () => {
    expect(linkify("javascript:alert(1) ftp://x")).toEqual([{ text: "javascript:alert(1) ftp://x" }]);
  });
});

describe("addresses", () => {
  it("go both ways", () => {
    expect(keyOf("/")).toBe("r1");
    expect(keyOf("/r/7")).toBe("r7");
    expect(keyOf("/d/3/")).toBe("d3");
    expect(keyOf("/x/3")).toBe("r1");
    expect(pathOf("r1")).toBe("/");
    expect(pathOf("r7")).toBe("/r/7");
    expect(pathOf("d3")).toBe("/d/3");
  });
});
