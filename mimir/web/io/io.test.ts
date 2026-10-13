import { describe, expect, it } from "vitest";
import { layoutMap, type LayoutTree } from "../layout/layout.ts";
import { createMeasurer } from "../layout/measure.ts";
import { drawnBounds, shownArrows } from "../layout/geometry.ts";
import { findUrls, linkPieces } from "../text/links.ts";
import { plainText } from "../text/plain.ts";
import { leftOut, opmlAsBackup, tooBig } from "./importer.ts";
import { looksLikeOpml, parseOpml, toOpml } from "./opml.ts";
import { pictureScale } from "./png.ts";
import { parsePlainText, toPlainText, type TextSource } from "./plaintext.ts";
import { mapToSvg } from "./svgExport.ts";

/** A small map as copying and exporting see it. */
const source: TextSource = {
  text: (id) => ({ r: "Trip", a: "Go\nby train", b: 'Stay & eat "well"', b1: "Hotel" })[id] ?? "",
  children: (id) => ({ r: ["a", "b"], b: ["b1"] })[id] ?? [],
};

describe("clipboard text", () => {
  it("writes a branch as indented lines, further lines under their node", () => {
    expect(toPlainText(source, "r")).toBe('- Trip\n  - Go\n    by train\n  - Stay & eat "well"\n    - Hotel');
  });

  it("reads it back, markup as plain text", () => {
    const drafts = parsePlainText(toPlainText(source, "r"));
    expect(drafts).toEqual([
      {
        text: "Trip",
        children: [
          { text: "Go\nby train", children: [] },
          { text: 'Stay & eat "well"', children: [{ text: "Hotel", children: [] }] },
        ],
      },
    ]);
    expect(parsePlainText("- **Bold** [site](https://x.org)\n- [ ] task")[0]!.text).toBe("Bold site (https://x.org)");
    expect(parsePlainText("one\ntwo")).toHaveLength(2);
  });
});

describe("OPML", () => {
  it("writes and reads a branch", () => {
    const xml = toOpml(source, "r", "Trip");
    expect(looksLikeOpml(xml)).toBe(true);
    expect(xml).toContain('<outline text="Go&#10;by train"/>');
    const file = parseOpml(xml);
    expect(file.title).toBe("Trip");
    expect(file.drafts[0]!.children[1]!.text).toBe('Stay & eat "well"');
    expect(file.drafts[0]!.children[0]!.text).toBe("Go\nby train");
  });

  it("drops notes and completion marks, counting them", () => {
    const file = parseOpml(
      '<opml version="2.0"><body><outline text="A" _note="n"><outline text="B" _complete="true"/></outline><outline text="&lt;b&gt;C&lt;/b&gt;"/></body></opml>',
    );
    expect(file.drafts.map((d) => d.text)).toEqual(["A", "C"]);
    expect(leftOut(file)).toBe(" Left out 1 note and 1 completion mark: maps don't have them.");
  });

  it("makes one outline the root, or hangs several from one named after the file", () => {
    const one = parseOpml('<opml><body><outline text="Root"><outline text="x"/></outline></body></opml>');
    expect(opmlAsBackup(one, "f.opml").maps[0]!.root).toEqual({ text: "Root", children: [{ text: "x" }] });
    const many = parseOpml('<opml><body><outline text="a"/><outline text="b"/></body></opml>');
    expect(opmlAsBackup(many, "Ideas.opml").maps[0]!.root.text).toBe("Ideas");
    expect(tooBig(many, 2)).toMatch(/at most/);
  });
});

describe("links", () => {
  it("finds addresses, leaving sentence punctuation out", () => {
    expect(
      findUrls("See https://x.org/a. And (https://en.wikipedia.org/wiki/Mimir_(god)) or mailto:me@x.org!"),
    ).toEqual(["https://x.org/a", "https://en.wikipedia.org/wiki/Mimir_(god)", "mailto:me@x.org"]);
    expect(findUrls("javascript:alert(1) and https:// alone")).toEqual([]);
  });

  it("follows an address wrapped over lines", () => {
    const url = "https://www.booking.com/searchresults.html?dest=lisbon";
    const pieces = linkPieces(["Booking.com", "https://www.booking.com/searchre", "sults.html?dest=lisbon"], [url]);
    expect(pieces[0]).toEqual([{ text: "Booking.com", href: null }]);
    expect(pieces[1]).toEqual([{ text: "https://www.booking.com/searchre", href: url }]);
    expect(pieces[2]).toEqual([{ text: "sults.html?dest=lisbon", href: url }]);
  });

  it("doesn't take a word ending in h for the start of an address", () => {
    const pieces = linkPieces(["Search", "https://x.org"], ["https://x.org"]);
    expect(pieces[0]).toEqual([{ text: "Search", href: null }]);
    expect(pieces[1]).toEqual([{ text: "https://x.org", href: "https://x.org" }]);
  });

  it("turns Yggdrasil's markdown into plain text, keeping link addresses", () => {
    expect(plainText("**a** __b__ `c` [d](https://e.org) [f](/api/files/x) !(2026-10-13)")).toBe(
      "a b c d (https://e.org) f 2026-10-13",
    );
  });
});

describe("picture", () => {
  const measure = createMeasurer((text, style) => [...text].length * style.size * 0.5);
  const tree: LayoutTree = {
    rootId: "r",
    get: (id) => ({ text: id === "r" ? "Trip <&>" : id, side: id === "r" ? null : "right", collapsed: false }),
    children: (id) => (id === "r" ? ["a", "b"] : []),
  };
  const layout = layoutMap(tree, measure);

  it("draws the map with its text escaped and no stylesheet", () => {
    const svg = mapToSvg(layout, []);
    expect(svg).toContain("Trip &lt;&amp;&gt;");
    expect(svg).not.toContain("<style");
    expect(svg).not.toContain("foreignObject");
  });

  it("makes room for arrows that bow out past the nodes", () => {
    const arrow = { id: "x", fromId: "a", toId: "b", label: "long label here", deletedAt: null };
    const arrows = shownArrows(
      layout,
      [arrow],
      () => "r",
      () => true,
    );
    expect(arrows).toHaveLength(1);
    const b = drawnBounds(layout, arrows);
    expect(b.x + b.w).toBeGreaterThan(layout.bounds.x + layout.bounds.w);
  });

  it("keeps big pictures inside the browser's canvas limits", () => {
    expect(pictureScale(1000, 500, 64_000_000)).toBe(2);
    expect(pictureScale(20_000, 1000, 64_000_000)).toBeCloseTo(16_384 / 20_000);
    expect(pictureScale(5000, 5000, 16_700_000)).toBeLessThan(1);
  });
});
