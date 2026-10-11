import { describe, expect, it } from "vitest";
import type { Node } from "../../shared/protocol.ts";
import { insertDrafts, type Ctx, type Draft } from "../model/commands.ts";
import { Store } from "../model/store.ts";
import { OpmlError, countDrafts, htmlToMarkdown, looksLikeOpml, parseOpml, toOpml } from "./opml.ts";
import type { TextSource } from "./plaintext.ts";
import dynalist from "./fixtures/dynalist.opml?raw";
import workflowy from "./fixtures/workflowy.opml?raw";

const FIXTURES: Record<string, string> = { "dynalist.opml": dynalist, "workflowy.opml": workflowy };
const fixture = (name: string) => FIXTURES[name]!;

describe("parseOpml", () => {
  it("imports a Dynalist export as markdown, with notes and completion", () => {
    const { title, drafts } = parseOpml(fixture("dynalist.opml"));
    expect(title).toBe("Reading list");
    expect(drafts).toEqual([
      {
        content: "Books",
        note: "Read before winter.\nAsk Freya for her copies.",
        children: [
          { content: "**The Prose Edda** by Snorri", completed: true, children: [] },
          { content: "__Heimskringla__ #history !(2026-11-01)", children: [] },
          {
            content: "Poetic Edda",
            children: [
              { content: "Völuspá", children: [] },
              { content: "Hávamál — read `stanza 77` aloud", note: "Cattle die, kinsmen die", children: [] },
            ],
          },
        ],
      },
      {
        content: "Links & notes",
        children: [
          { content: "[Dynalist help](https://help.dynalist.io) and https://example.com/a?b=1", children: [] },
          // Dynalist text is markdown, so this stays as written.
          { content: "Ask @freya about <runes>", children: [] },
          { content: "", children: [] },
        ],
      },
    ]);
  });

  it("imports a Workflowy export, turning its HTML into markdown", () => {
    const { title, drafts } = parseOpml(fixture("workflowy.opml"));
    expect(title).toBeNull();
    expect(drafts).toEqual([
      {
        content: "Projects",
        children: [
          {
            content: "**Launch** the __longship__",
            note: "Before the storm\nCheck the oars",
            children: [
              { content: "Caulk the hull", completed: true, children: [] },
              { content: "See [the map](https://example.com/map)", children: [] },
            ],
          },
          { content: "Red text and ~~old plan~~ #urgent", children: [] },
          // Unsafe links and unknown tags become plain text; nothing runs.
          { content: "Bad link ", children: [] },
          { content: "Fish & chips", children: [] },
        ],
      },
    ]);
  });

  it("refuses what isn't OPML", () => {
    expect(() => parseOpml("<html><body/></html>")).toThrow(OpmlError);
    expect(() => parseOpml("not xml <")).toThrow(OpmlError);
    expect(() => parseOpml("<opml><head/></opml>")).toThrow(OpmlError);
  });

  it("recognises OPML text", () => {
    expect(looksLikeOpml(fixture("dynalist.opml"))).toBe(true);
    expect(looksLikeOpml('  <opml version="2.0">')).toBe(true);
    expect(looksLikeOpml("- a bullet")).toBe(false);
  });
});

describe("htmlToMarkdown", () => {
  it("keeps only known inline formatting", () => {
    expect(htmlToMarkdown("<b>a</b> <em>b</em> <del>c</del> <code>d</code> <u>e</u>")).toBe("**a** __b__ ~~c~~ `d` e");
    expect(htmlToMarkdown('<a href="https://x.y">https://x.y</a>')).toBe("https://x.y");
    expect(htmlToMarkdown("<script>alert(1)</script>ok")).toBe("alert(1)ok");
  });
});

describe("export", () => {
  /** A store holding drafts, made the way an import makes them. */
  function storeOf(drafts: Draft[]) {
    const store = new Store();
    let n = 0;
    const ctx: Ctx = {
      get: (id) => store.get(id),
      children: (p) => store.children(p),
      shown: (p) => store.children(p),
      expanded: () => true,
      root: null,
      newId: () => `id${++n}`,
      now: () => "2026-10-11T12:00:00.000Z",
    };
    const { ops, ids } = insertDrafts(ctx, null, null, drafts);
    store.applyAll(ops);
    const source: TextSource = { get: (id) => store.get(id) as Node, children: (id) => store.children(id) };
    return { source, ids };
  }

  it("round-trips: import, export and import again give the same tree", () => {
    for (const name of ["dynalist.opml", "workflowy.opml"]) {
      const first = parseOpml(fixture(name)).drafts;
      const { source, ids } = storeOf(first);
      const exported = toOpml(source, ids, "Round trip");
      const again = parseOpml(exported);
      expect(again.title).toBe("Round trip");
      expect(again.drafts).toEqual(first);
    }
  });

  it("escapes text and keeps notes' line breaks", () => {
    const { source, ids } = storeOf([{ content: 'a "quoted" <b> & c', note: "two\nlines", children: [] }]);
    const xml = toOpml(source, ids, "T");
    expect(xml).toContain('text="a &quot;quoted&quot; &lt;b&gt; &amp; c" _note="two&#10;lines"');
  });

  it("counts drafts with their subtrees", () => {
    expect(countDrafts(parseOpml(fixture("dynalist.opml")).drafts)).toBe(10);
  });
});
