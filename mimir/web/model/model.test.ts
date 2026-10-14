import { describe, expect, it } from "vitest";
import type { MapNode, Op, Side } from "../../shared/protocol.ts";
import {
  childPlacement,
  create,
  crossSide,
  demote,
  insertDrafts,
  moveAmongSiblings,
  moveTo,
  promote,
  remove,
  siblingPlacement,
  type Ctx,
} from "./commands.ts";
import { MapStore } from "./store.ts";
import { enqueue, guardedParts, takeBatch, type Entry } from "./sync.ts";

/**
 * A store from indented lines: "root" first, then "[right] Work", "  Mail", … Ids are the texts
 * (lowercased), so a test can name them.
 */
function storeOf(text: string): MapStore {
  const store = new MapStore();
  const nodes: MapNode[] = [];
  const parents: string[] = [];
  let rank = 0;
  for (const line of text.trim().split("\n")) {
    const depth = (line.length - line.trimStart().length) / 2;
    const m = /^(?:\[(left|right)\] )?(.*)$/.exec(line.trim())!;
    const id = m[2]!.toLowerCase();
    parents[depth] = id;
    nodes.push({
      id,
      parentId: depth === 0 ? null : parents[depth - 1]!,
      rank: `a${rank++}`,
      side: (m[1] as Side | undefined) ?? null,
      text: m[2]!,
      collapsed: false,
      deletedAt: null,
    });
  }
  store.load(nodes, []);
  return store;
}

let ids = 0;
const ctxOf = (store: MapStore): Ctx => ({
  rootId: store.rootId,
  get: (id) => store.get(id),
  children: (id) => store.children(id),
  newId: () => `new${++ids}`,
});

/** The live map as indented lines, the same shape storeOf reads. */
function show(store: MapStore): string {
  const lines: string[] = [];
  const walk = (id: string, depth: number) => {
    const n = store.get(id)!;
    lines.push(`${"  ".repeat(depth)}${n.side ? `[${n.side}] ` : ""}${n.text}`);
    for (const k of store.liveChildren(id)) walk(k, depth + 1);
  };
  walk(store.rootId, 0);
  return lines.join("\n");
}

/** Applies a command's ops; returns the ops that undo them. */
function run(store: MapStore, result: { ops: Op[] } | null): Op[] {
  if (!result) throw new Error("the command did nothing");
  return store.applyAll(result.ops);
}

const MAP = `
Plans
  [right] Work
    Mail
    Calls
  [left] Home
    Garden
  [right] Fun
`;

describe("commands", () => {
  it("adds children and siblings, a main branch on the side asked for", () => {
    const store = storeOf(MAP);
    const ctx = ctxOf(store);
    run(store, create(ctx, "x", childPlacement(ctx, "work", "right"), "Reports"));
    run(store, create(ctx, "y", siblingPlacement(ctx, "mail", true), "Inbox"));
    run(store, create(ctx, "z", childPlacement(ctx, "plans", "left"), "Travel"));
    expect(show(store)).toBe(
      "Plans\n  [right] Work\n    Inbox\n    Mail\n    Calls\n    Reports\n  [left] Home\n    Garden\n  [left] Travel\n  [right] Fun",
    );
  });

  it("moves main branches up and down within their side only", () => {
    const store = storeOf(MAP);
    const ctx = ctxOf(store);
    run(store, moveAmongSiblings(ctx, "fun", -1));
    const onSide = (side: Side) => store.liveChildren("plans").filter((k) => store.get(k)!.side === side);
    expect(onSide("right")).toEqual(["fun", "work"]);
    expect(onSide("left")).toEqual(["home"]);
    expect(moveAmongSiblings(ctx, "home", -1)).toBeNull();
  });

  it("demotes into the sibling above, and promotes back after the parent", () => {
    const store = storeOf(MAP);
    const ctx = ctxOf(store);
    run(store, demote(ctx, "calls"));
    expect(show(store)).toContain("    Mail\n      Calls");
    run(store, promote(ctx, "calls"));
    run(store, promote(ctx, "calls"));
    // Promoted to a main branch, it keeps its old branch's side and comes right after it.
    expect(show(store)).toBe(
      "Plans\n  [right] Work\n    Mail\n  [right] Calls\n  [left] Home\n    Garden\n  [right] Fun",
    );
    expect(demote(ctx, "mail")).toBeNull();
  });

  it("crosses a main branch to the other side", () => {
    const store = storeOf(MAP);
    const ctx = ctxOf(store);
    run(store, crossSide(ctx, "fun", "home"));
    expect(store.get("fun")!.side).toBe("left");
    expect(store.liveChildren("plans").filter((k) => store.get(k)!.side === "left")).toEqual(["home", "fun"]);
  });

  it("refuses to move a node inside itself, and unfolds where it lands", () => {
    const store = storeOf(MAP);
    const ctx = ctxOf(store);
    expect(moveTo(ctx, "work", "mail", null, null)).toBeNull();
    store.applyAll([{ op: "update", id: "home", collapsed: true }]);
    run(store, moveTo(ctx, "calls", "home", "garden", null));
    expect(store.get("home")!.collapsed).toBe(false);
    expect(store.liveChildren("home")).toEqual(["garden", "calls"]);
  });

  it("deletes a branch and brings it back with the inverse ops", () => {
    const store = storeOf(MAP);
    const ctx = ctxOf(store);
    const undo = run(store, remove(ctx, "work"));
    expect(show(store)).not.toContain("Work");
    store.applyAll(undo);
    expect(show(store)).toBe(show(storeOf(MAP)));
    expect(remove(ctx, "plans")).toBeNull();
  });

  it("inserts drafts, main branches on the side with fewer nodes, deeper ones folded", () => {
    const store = storeOf(MAP);
    const ctx = ctxOf(store);
    const result = insertDrafts(ctx, "plans", [
      { text: "A", children: [{ text: "A1", children: [{ text: "deep", children: [] }] }] },
      { text: "B", children: [] },
    ]);
    run(store, result);
    // Left holds 2 nodes and right 4: A (3 nodes) goes left, which then holds 5, so B goes right.
    expect(store.get(result!.select!)!.text).toBe("A");
    const byText = (t: string) => store.liveChildren("plans").find((k) => store.get(k)!.text === t)!;
    const a = byText("A");
    expect(store.get(a)!.side).toBe("left");
    expect(store.get(byText("B"))!.side).toBe("right");
    const a1 = store.liveChildren(a)[0]!;
    expect(store.get(a)!.collapsed).toBe(false);
    expect(store.get(a1)!.collapsed).toBe(true);
  });
});

describe("store", () => {
  it("undoes a move with its side, and an arrow's label", () => {
    const store = storeOf(MAP);
    const undo = store.applyAll([
      { op: "move", id: "fun", parentId: "plans", rank: "a9", side: "left" },
      { op: "createArrow", id: "x", fromId: "mail", toId: "garden", label: "about" },
    ]);
    expect(store.get("fun")!.side).toBe("left");
    store.applyAll([{ op: "updateArrow", id: "x", label: "re" }]);
    store.applyAll(undo);
    expect(store.get("fun")).toMatchObject({ side: "right", rank: "a6" });
    expect(store.arrow("x")!.deletedAt).not.toBeNull();
  });

  it("knows which nodes are inside a deleted branch", () => {
    const store = storeOf(MAP);
    store.applyAll([{ op: "delete", id: "work" }]);
    expect(store.isLive("mail")).toBe(false);
    expect(store.isLive("garden")).toBe(true);
  });
});

describe("sync queue", () => {
  it("folds edits into a queued create, but never across maps", () => {
    const queue: Entry[] = [];
    enqueue(queue, { mapId: "m1", op: { op: "create", id: "n", parentId: "p", rank: "a0", side: null } });
    enqueue(queue, { mapId: "m1", op: { op: "update", id: "n", text: "Hello" } });
    enqueue(queue, { mapId: "m2", op: { op: "update", id: "n", text: "Other" } });
    expect(queue).toEqual([
      { mapId: "m1", op: { op: "create", id: "n", parentId: "p", rank: "a0", side: null, text: "Hello" } },
      { mapId: "m2", op: { op: "update", id: "n", text: "Other" } },
    ]);
  });

  it("sends one map at a time", () => {
    const queue: Entry[] = [
      { mapId: "m1", op: { op: "delete", id: "a" } },
      { mapId: "m1", op: { op: "delete", id: "b" } },
      { mapId: "m2", op: { op: "delete", id: "c" } },
    ];
    expect(takeBatch(queue).map((e) => e.op.id)).toEqual(["a", "b"]);
    expect(takeBatch(queue).map((e) => e.op.id)).toEqual(["c"]);
  });

  it("guards what local ops change from older server rows", () => {
    const guarded = guardedParts([
      { op: "move", id: "a", parentId: "p", rank: "a0", side: "left" },
      { op: "update", id: "b", text: "x" },
      { op: "updateArrow", id: "c", label: "y" },
    ]);
    expect([...guarded.get("a")!]).toEqual(["place"]);
    expect([...guarded.get("b")!]).toEqual(["text"]);
    expect([...guarded.get("c")!]).toEqual(["label"]);
  });
});
