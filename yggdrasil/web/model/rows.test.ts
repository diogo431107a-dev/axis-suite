import { describe, expect, it } from "vitest";
import type { Node } from "../../shared/protocol.ts";
import { visibleRows } from "./rows.ts";
import { Store, newNode } from "./store.ts";
import type { View } from "./ui.ts";

const VIEW: View = { zoom: null, showCompleted: true, filter: null, matches: null, highlight: null };

function store(nodes: (Partial<Node> & { id: string; parentId: string | null; rank: string })[]) {
  const s = new Store();
  s.load(nodes.map((n) => ({ ...newNode(n.id, n.parentId, n.rank), ...n })));
  return s;
}

const tree = () =>
  store([
    { id: "a", parentId: null, rank: "a0" },
    { id: "b", parentId: "a", rank: "a0" },
    { id: "c", parentId: "b", rank: "a0" },
    { id: "d", parentId: "a", rank: "a1", completedAt: "2026-10-01T00:00:00.000Z" },
    { id: "e", parentId: null, rank: "a1", collapsed: true },
    { id: "f", parentId: "e", rank: "a0" },
    { id: "g", parentId: null, rank: "a2", deletedAt: "2026-10-01T00:00:00.000Z" },
    { id: "h", parentId: "g", rank: "a0" },
  ]);

const show = (rows: { id: string; depth: number }[]) => rows.map((r) => `${r.id}${r.depth}`).join(" ");

describe("visibleRows", () => {
  it("lists shown bullets in reading order with their depth, skipping collapsed and deleted subtrees", () => {
    expect(show(visibleRows(tree(), VIEW))).toBe("a0 b1 c2 d1 e0");
  });

  it("leaves out completed bullets when they are hidden", () => {
    expect(show(visibleRows(tree(), { ...VIEW, showCompleted: false }))).toBe("a0 b1 c2 e0");
  });

  it("starts inside the zoomed-in bullet", () => {
    expect(show(visibleRows(tree(), { ...VIEW, zoom: "a" }))).toBe("b0 c1 d0");
  });

  it("shows only a search's bullets, expanded even when collapsed", () => {
    expect(show(visibleRows(tree(), { ...VIEW, filter: new Set(["e", "f"]) }))).toBe("e0 f1");
  });

  it("counts shape changes, not typing", () => {
    const s = tree();
    const before = s.structure;
    s.applyAll([{ op: "update", id: "b", content: "typing" }]);
    expect(s.structure).toBe(before);
    s.applyAll([{ op: "update", id: "a", collapsed: true }]);
    expect(s.structure).toBe(before + 1);
    s.applyAll([{ op: "move", id: "f", parentId: null, rank: "a3" }]);
    expect(s.structure).toBe(before + 2);
  });
});
