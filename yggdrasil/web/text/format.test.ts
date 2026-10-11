import { describe, expect, it } from "vitest";
import { makeLink, toggleWrap } from "./format.ts";

describe("toggleWrap", () => {
  it("wraps the selection and keeps it selected", () => {
    expect(toggleWrap("make this bold", 5, 9, "**")).toEqual({ value: "make **this** bold", start: 7, end: 11 });
  });

  it("unwraps when the markers are around the selection, or inside it", () => {
    expect(toggleWrap("make **this** bold", 7, 11, "**")).toEqual({ value: "make this bold", start: 5, end: 9 });
    expect(toggleWrap("make **this** bold", 5, 13, "**")).toEqual({ value: "make this bold", start: 5, end: 9 });
  });

  it("puts the caret between the markers when nothing is selected", () => {
    expect(toggleWrap("ab", 1, 1, "__")).toEqual({ value: "a____b", start: 3, end: 3 });
  });
});

describe("makeLink", () => {
  it("links the selected text and selects the address placeholder", () => {
    const edit = makeLink("see docs here", 4, 8);
    expect(edit.value).toBe("see [docs](https://) here");
    expect(edit.value.slice(edit.start, edit.end)).toBe("https://");
  });

  it("inserts an empty link with the caret in the brackets when nothing is selected", () => {
    expect(makeLink("ab", 1, 1)).toEqual({ value: "a[]()b", start: 2, end: 2 });
  });

  it("uses a selected URL as the address and puts the caret in the text", () => {
    expect(makeLink("x https://a.b y", 2, 13)).toEqual({ value: "x [](https://a.b) y", start: 3, end: 3 });
  });
});
