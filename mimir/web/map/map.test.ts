import { describe, expect, it } from "vitest";
import type { Side } from "../../shared/protocol.ts";
import { layoutMap, type LayoutTree } from "../layout/layout.ts";
import { createMeasurer } from "../layout/measure.ts";
import { dropTarget } from "./drop.ts";
import { intentOf, letterOf, type Mode } from "./keys.ts";
import { navigate } from "./navigate.ts";

const measure = createMeasurer((text, style) => [...text].length * style.size * 0.5);

interface Spec {
  side?: Side;
  collapsed?: boolean;
  kids?: string[];
}

function tree(nodes: Record<string, Spec>): LayoutTree {
  for (const spec of Object.values(nodes)) for (const k of spec.kids ?? []) nodes[k] ??= {};
  return {
    rootId: "root",
    get: (id) => {
      const n = nodes[id];
      return n && { text: id, side: n.side ?? null, collapsed: n.collapsed ?? false };
    },
    children: (id) => nodes[id]?.kids ?? [],
  };
}

//            ┌ a1          b1 ┐
//  [left] b ─┤      root      ├─ a [right]
//            └ b2          a2 ┘
//                          c [right, folded]
const layout = layoutMap(
  tree({
    root: { kids: ["a", "b", "c"] },
    a: { side: "right", kids: ["a1", "a2"] },
    b: { side: "left", kids: ["b1", "b2"] },
    c: { side: "right", collapsed: true, kids: ["c1"] },
  }),
  measure,
);
const box = (id: string) => layout.boxes.get(id)!;
const mid = (id: string) => ({ x: box(id).x + box(id).w / 2, y: box(id).y + box(id).h / 2 });

describe("navigate", () => {
  it("enters each side from the root", () => {
    expect(navigate(layout, "root", "right")).toBe("a");
    expect(navigate(layout, "root", "left")).toBe("b");
    expect(navigate(layout, "root", "up")).toBeNull();
  });

  it("goes outward to a child and inward to the parent, mirrored on the left", () => {
    expect(navigate(layout, "a", "right")).toBe("a1");
    expect(navigate(layout, "a", "left")).toBe("root");
    expect(navigate(layout, "b", "left")).toBe("b1");
    expect(navigate(layout, "b", "right")).toBe("root");
    expect(navigate(layout, "a1", "right")).toBeNull();
    // A folded node shows no children to go to.
    expect(navigate(layout, "c", "right")).toBeNull();
  });

  it("returns to the child last visited", () => {
    expect(navigate(layout, "a", "right", new Map([["a", "a2"]]))).toBe("a2");
  });

  it("goes up and down a column, across parents", () => {
    expect(navigate(layout, "a", "down")).toBe("c");
    expect(navigate(layout, "c", "up")).toBe("a");
    expect(navigate(layout, "a", "up")).toBeNull();
    expect(navigate(layout, "a1", "down")).toBe("a2");
  });
});

describe("keys", () => {
  const key = (k: string, extra: Partial<KeyboardEvent> = {}, mode: Mode = "node") =>
    intentOf(
      { key: k, code: "", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, repeat: false, ...extra },
      mode,
    );

  it("reads letters on any keyboard", () => {
    expect(letterOf({ key: "N", code: "KeyN" })).toBe("n");
    expect(letterOf({ key: "т", code: "KeyN" })).toBe("n");
    expect(letterOf({ key: "1", code: "Digit1" })).toBeNull();
  });

  it("maps the keys of a selected node", () => {
    expect(key("Enter")).toEqual({ kind: "edit" });
    expect(key("Tab")).toEqual({ kind: "add-child" });
    expect(key("n")).toEqual({ kind: "add-sibling", before: false });
    expect(key("N", { shiftKey: true })).toEqual({ kind: "add-sibling", before: true });
    expect(key("ArrowUp", { ctrlKey: true, shiftKey: true })).toEqual({ kind: "move", dir: "up" });
    expect(key("ArrowLeft", { metaKey: true, shiftKey: true })).toEqual({ kind: "move", dir: "left" });
    expect(key(" ")).toEqual({ kind: "fold" });
    expect(key("Delete")).toEqual({ kind: "delete" });
    expect(key("a")).toEqual({ kind: "arrow-start" });
    expect(key("z", { ctrlKey: true })).toEqual({ kind: "undo" });
    expect(key("Z", { ctrlKey: true, shiftKey: true })).toEqual({ kind: "redo" });
    expect(key("+", { shiftKey: true })).toEqual({ kind: "zoom", by: "in" });
    expect(key("?", { shiftKey: true })).toEqual({ kind: "help" });
  });

  it("leaves typing, browser zoom and Shift+Tab alone", () => {
    expect(key("x")).toBeNull();
    expect(key("=", { ctrlKey: true })).toBeNull();
    expect(key("0", { ctrlKey: true })).toBeNull();
    expect(key("Tab", { shiftKey: true })).toBeNull();
    expect(key("Tab", {}, "none")).toBeNull();
  });

  it("doesn't add a node per repeat of a held key", () => {
    expect(key("n", { repeat: true })).toBeNull();
    expect(key("ArrowDown", { repeat: true })).toEqual({ kind: "nav", dir: "down" });
  });

  it("while picking an arrow's target, only moves, confirms or cancels", () => {
    expect(key("ArrowRight", {}, "pick")).toEqual({ kind: "nav", dir: "right" });
    expect(key("Enter", {}, "pick")).toEqual({ kind: "confirm" });
    expect(key("a", {}, "pick")).toEqual({ kind: "confirm" });
    expect(key("Escape", {}, "pick")).toEqual({ kind: "escape" });
    expect(key("Delete", {}, "pick")).toBeNull();
  });
});

describe("dropTarget", () => {
  it("drops on the root as a main branch on that side", () => {
    const root = box("root");
    const left = dropTarget(layout, "a1", root.x + 2, root.y + root.h / 2, 1);
    expect(left).toMatchObject({ parentId: "root", side: "left" });
    const right = dropTarget(layout, "b1", root.x + root.w - 2, root.y + 1, 1);
    expect(right).toMatchObject({ parentId: "root", side: "right" });
  });

  it("drops on a node as its last child", () => {
    const { x, y } = mid("b2");
    expect(dropTarget(layout, "a1", x, y, 1)).toMatchObject({ parentId: "b2", into: "b2", afterId: undefined });
  });

  it("drops above or below a node as its sibling", () => {
    const a2 = box("a2");
    expect(dropTarget(layout, "b1", a2.x + 5, a2.y + a2.h + 2, 1)).toMatchObject({
      parentId: "a",
      afterId: "a2",
      side: null,
    });
    expect(dropTarget(layout, "b1", a2.x + 5, a2.y - 2, 1)).toMatchObject({ parentId: "a", afterId: "a1" });
  });

  it("drops past a leaf's outer edge as its child", () => {
    const b1 = box("b1");
    expect(dropTarget(layout, "a1", b1.x - 10, b1.y + b1.h / 2, 1)).toMatchObject({ parentId: "b1", into: "b1" });
  });

  it("never drops a node into its own branch, nor far from everything", () => {
    const { x, y } = mid("a1");
    expect(dropTarget(layout, "a", x, y, 1)?.parentId).not.toBe("a1");
    expect(dropTarget(layout, "a1", 10_000, 10_000, 1)).toBeNull();
  });
});
