import { describe, expect, it } from "vitest";
import type { Side } from "../../shared/protocol.ts";
import { layoutMap, type LayoutTree } from "./layout.ts";
import { createMeasurer } from "./measure.ts";
import { GAP, styleOf } from "./theme.ts";
import { wrap } from "./wrap.ts";

/** Every character is half the font size wide: easy sums. */
const fakeWidth = (text: string, style: { size: number }) => [...text].length * style.size * 0.5;
const measure = createMeasurer(fakeWidth);

interface Spec {
  text?: string;
  side?: Side;
  collapsed?: boolean;
  kids?: string[];
}

/** A tree from a table of nodes; "root" is the root. Children missing from the table are plain leaves. */
function tree(nodes: Record<string, Spec>): LayoutTree {
  for (const spec of Object.values(nodes)) for (const k of spec.kids ?? []) nodes[k] ??= {};
  return {
    rootId: "root",
    get: (id) => {
      const n = nodes[id];
      return n && { text: n.text ?? id, side: n.side ?? null, collapsed: n.collapsed ?? false };
    },
    children: (id) => nodes[id]?.kids ?? [],
  };
}

describe("wrap", () => {
  const width = (s: string) => s.length * 10;

  it("keeps a short text on one line, and breaks at spaces", () => {
    expect(wrap("short", 100, width)).toEqual(["short"]);
    expect(wrap("one two three four", 100, width)).toEqual(["one two", "three four"]);
  });

  it("keeps line breaks, and counts runs of spaces as one", () => {
    expect(wrap("a\n\nb   c", 100, width)).toEqual(["a", "", "b c"]);
    expect(wrap("", 100, width)).toEqual([""]);
  });

  it("breaks a word wider than a line between characters", () => {
    expect(wrap("https://example.com/long", 100, width)).toEqual(["https://ex", "ample.com/", "long"]);
    expect(wrap("see https://example.com/long now", 100, width)).toEqual([
      "see",
      "https://ex",
      "ample.com/",
      "long now",
    ]);
  });
});

describe("measure", () => {
  it("sizes a box from its text and the level's padding", () => {
    const main = styleOf(1);
    const m = measure("Work", 1);
    expect(m.lines).toEqual(["Work"]);
    expect(m.w).toBe(4 * 8 + 2 + 2 * main.padX);
    expect(m.h).toBe(main.lineHeight + 2 * main.padY);
    expect(measure("", 1).w).toBe(main.minWidth);
  });
});

describe("layoutMap", () => {
  it("puts the root at the centre and the main branches on their sides", () => {
    const l = layoutMap(tree({ root: { kids: ["a", "b"] }, a: { side: "right" }, b: { side: "left" } }), measure);
    const root = l.boxes.get("root")!;
    expect(root.x + root.w / 2).toBe(0);
    expect(root.y + root.h / 2).toBe(0);
    const a = l.boxes.get("a")!;
    const b = l.boxes.get("b")!;
    expect(a.x).toBe(root.x + root.w + GAP.root);
    expect(b.x + b.w).toBe(root.x - GAP.root);
    // Alone on its side, each is centred on the root.
    expect(a.y + a.h / 2).toBe(0);
    expect(b.y + b.h / 2).toBe(0);
    expect(l.order).toEqual(["root", "a", "b"]);
  });

  it("stacks siblings without overlap, the parent centred on its children", () => {
    const l = layoutMap(
      tree({
        root: { kids: ["a"] },
        a: { side: "right", kids: ["a1", "a2", "a3"] },
      }),
      measure,
    );
    const [a1, a2, a3] = ["a1", "a2", "a3"].map((id) => l.boxes.get(id)!);
    expect(a2!.y).toBe(a1!.y + a1!.h + GAP.down);
    expect(a3!.y).toBe(a2!.y + a2!.h + GAP.down);
    const a = l.boxes.get("a")!;
    expect(a.y + a.h / 2).toBeCloseTo((a1!.y + a3!.y + a3!.h) / 2);
    expect(a1!.x).toBe(a.x + a.w + GAP.across);
    expect(l.columns.get("right:2")).toEqual(["a1", "a2", "a3"]);
  });

  it("gives a branch the room its children need", () => {
    const l = layoutMap(
      tree({
        root: { kids: ["a", "b"] },
        a: { side: "right", kids: ["a1", "a2", "a3", "a4"] },
        b: { side: "right" },
      }),
      measure,
    );
    const a4 = l.boxes.get("a4")!;
    const b = l.boxes.get("b")!;
    expect(b.y).toBeGreaterThanOrEqual(a4.y + a4.h + GAP.main);
    expect(l.sideHeight.left).toBe(0);
  });

  it("hides a folded node's children and counts them", () => {
    const l = layoutMap(
      tree({
        root: { kids: ["a"] },
        a: { side: "left", collapsed: true, kids: ["a1", "a2"] },
        a1: { kids: ["x"] },
      }),
      measure,
    );
    expect(l.order).toEqual(["root", "a"]);
    expect(l.boxes.get("a")).toMatchObject({ hidden: 3, kids: 0 });
    // The badge sits on the outer (left) side, inside the bounds.
    expect(l.bounds.x).toBeLessThan(l.boxes.get("a")!.x);
  });

  it("goes thousands of levels deep without running out of stack", () => {
    const nodes: Record<string, Spec> = { root: { kids: ["n0"] } };
    for (let i = 0; i < 5000; i++) nodes[`n${i}`] = { side: i === 0 ? "right" : undefined, kids: [`n${i + 1}`] };
    nodes.n5000 = {};
    const l = layoutMap(tree(nodes), measure);
    expect(l.order).toHaveLength(5002);
    expect(l.boxes.get("n5000")!.level).toBe(5001);
  });

  it("reuses the boxes that didn't change", () => {
    const nodes: Record<string, Spec> = {
      root: { kids: ["a", "b"] },
      a: { side: "right" },
      b: { side: "left", kids: ["b1"] },
    };
    const first = layoutMap(tree(nodes), measure);
    nodes.b1 = { text: "a much longer text than before" };
    const second = layoutMap(tree(nodes), measure, first);
    expect(second.boxes.get("a")).toBe(first.boxes.get("a"));
    expect(second.boxes.get("b1")).not.toBe(first.boxes.get("b1"));
  });

  it("lays out 5,000 nodes quickly", () => {
    const nodes: Record<string, Spec> = { root: { kids: [] } };
    for (let m = 0; m < 10; m++) {
      const main = `m${m}`;
      nodes.root!.kids!.push(main);
      nodes[main] = { side: m % 2 ? "left" : "right", kids: [] };
      for (let c = 0; c < 20; c++) {
        const child = `${main}c${c}`;
        nodes[main]!.kids!.push(child);
        nodes[child] = { text: `Child number ${c} of ${m}`, kids: [] };
        for (let g = 0; g < 24; g++) {
          const leaf = `${child}g${g}`;
          nodes[child]!.kids!.push(leaf);
          nodes[leaf] = { text: `Leaf ${g} with a few words in it` };
        }
      }
    }
    const t = tree(nodes);
    const fresh = createMeasurer(fakeWidth);
    layoutMap(t, fresh);
    const start = performance.now();
    const l = layoutMap(t, fresh);
    expect(l.order.length).toBe(1 + 10 + 200 + 4800);
    expect(performance.now() - start).toBeLessThan(100);
  });
});
