import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Node, Op } from "../shared/protocol.ts";
import { openDatabase } from "./db.ts";
import { BatchError, createTree, type Tree } from "./tree.ts";

let tree: Tree;
beforeEach(() => {
  tree = createTree(openDatabase(":memory:"));
});

const ODIN = "odin";
const FREYA = "freya";

/** The user's visible tree as "content(children…)" text, siblings in order. */
function shape(nodes: Node[], parentId: string | null = null): string {
  return nodes
    .filter((n) => n.parentId === parentId)
    .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id < b.id ? -1 : 1))
    .map((n) => {
      const kids = shape(nodes, n.id);
      return kids ? `${n.content}(${kids})` : n.content;
    })
    .join(" ");
}

const visible = (owner = ODIN) => shape(tree.load(owner).nodes);

function apply(ops: Op[], owner = ODIN) {
  return tree.applyOps(owner, ops);
}

describe("applyOps", () => {
  it("creates, updates, moves, deletes and restores", () => {
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    expect(
      apply([
        { op: "create", id: a, parentId: null, rank: "a0", content: "A" },
        { op: "create", id: b, parentId: null, rank: "a1", content: "B" },
        { op: "create", id: c, parentId: a, rank: "a0", content: "C" },
      ]),
    ).toEqual({ rev: 1, rejected: [] });
    expect(visible()).toBe("A(C) B");

    apply([{ op: "update", id: c, content: "C!", note: "two\nlines", starred: true }]);
    const updated = tree.load(ODIN).nodes.find((n) => n.id === c)!;
    expect(updated).toMatchObject({ content: "C!", note: "two\nlines", starred: true, collapsed: false });

    apply([{ op: "move", id: c, parentId: b, rank: "a0" }]);
    expect(visible()).toBe("A B(C!)");

    apply([{ op: "delete", id: b }]);
    expect(visible()).toBe("A");

    apply([{ op: "restore", id: b }]);
    expect(visible()).toBe("A B(C!)");
  });

  it("stores completion as a timestamp and clears it", () => {
    const a = randomUUID();
    apply([{ op: "create", id: a, parentId: null, rank: "a0", completedAt: "2026-10-11T08:00:00.000Z" }]);
    expect(tree.load(ODIN).nodes[0]!.completedAt).toBe("2026-10-11T08:00:00.000Z");
    apply([{ op: "update", id: a, completedAt: null }]);
    expect(tree.load(ODIN).nodes[0]!.completedAt).toBeNull();
  });

  it("refuses to move a bullet under itself or a descendant", () => {
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    apply([
      { op: "create", id: a, parentId: null, rank: "a0", content: "A" },
      { op: "create", id: b, parentId: a, rank: "a0", content: "B" },
      { op: "create", id: c, parentId: b, rank: "a0", content: "C" },
    ]);
    const result = apply([
      { op: "move", id: a, parentId: c, rank: "a0" },
      { op: "move", id: a, parentId: a, rank: "a0" },
    ]);
    expect(result.rev).toBeNull();
    expect(result.rejected.map((r) => r.index)).toEqual([0, 1]);
    expect(visible()).toBe("A(B(C))");
  });

  it("refuses another user's ids, never overwriting them", () => {
    const [a, mine] = [randomUUID(), randomUUID()];
    apply([{ op: "create", id: a, parentId: null, rank: "a0", content: "Odin's" }]);
    const result = apply(
      [
        { op: "create", id: a, parentId: null, rank: "a0", content: "Freya's" },
        { op: "update", id: a, content: "changed" },
        { op: "move", id: a, parentId: null, rank: "b0" },
        { op: "delete", id: a },
        { op: "restore", id: a },
        { op: "create", id: mine, parentId: a, rank: "a0", content: "under Odin's" },
      ],
      FREYA,
    );
    expect(result.rejected).toEqual([
      { index: 0, reason: "id already in use" },
      { index: 1, reason: "unknown node" },
      { index: 2, reason: "unknown node" },
      { index: 3, reason: "unknown node" },
      { index: 4, reason: "unknown node" },
      { index: 5, reason: "unknown parent" },
    ]);
    expect(visible(ODIN)).toBe("Odin's");
    expect(visible(FREYA)).toBe("");
  });

  it("applies the valid ops of a batch and lists the invalid ones", () => {
    const a = randomUUID();
    const result = tree.applyOps(ODIN, [
      { op: "create", id: a, parentId: null, rank: "a0", content: "ok" },
      { op: "update", id: "not-a-uuid" },
      { op: "update", id: randomUUID(), content: "nobody" },
    ]);
    expect(result).toEqual({
      rev: 1,
      rejected: [
        { index: 1, reason: "id must be a UUID" },
        { index: 2, reason: "unknown node" },
      ],
    });
    expect(visible()).toBe("ok");
  });

  it("changes nothing when the same batch is sent again", () => {
    const [a, b] = [randomUUID(), randomUUID()];
    const batch: Op[] = [
      { op: "create", id: a, parentId: null, rank: "a0", content: "A" },
      { op: "create", id: b, parentId: a, rank: "a0", content: "B" },
      { op: "update", id: b, content: "B2", collapsed: true },
      { op: "move", id: b, parentId: null, rank: "a1" },
      { op: "delete", id: a },
    ];
    expect(apply(batch).rev).toBe(1);
    const before = tree.load(ODIN);
    expect(apply(batch)).toEqual({ rev: null, rejected: [] });
    expect(tree.load(ODIN)).toEqual(before);
    expect(tree.changesSince(ODIN, 1)).toEqual({ rev: 1, nodes: [] });
  });

  it("leaves an existing node alone when its create comes again", () => {
    const [a, b] = [randomUUID(), randomUUID()];
    apply([
      { op: "create", id: a, parentId: null, rank: "a0", content: "A" },
      { op: "create", id: b, parentId: null, rank: "a1", content: "B" },
    ]);
    // Edited on another device after the create was saved.
    apply([
      { op: "update", id: a, content: "A, edited" },
      { op: "delete", id: b },
    ]);
    const result = apply([
      { op: "create", id: a, parentId: null, rank: "a5", content: "A" },
      { op: "create", id: b, parentId: null, rank: "a1", content: "B" },
    ]);
    expect(result).toEqual({ rev: null, rejected: [] });
    expect(visible()).toBe("A, edited");
  });

  it("refuses more than 5,000 ops in one batch", () => {
    const ops = Array.from({ length: 5001 }, () => ({ op: "delete", id: randomUUID() }));
    expect(() => tree.applyOps(ODIN, ops)).toThrow(BatchError);
    expect(() => tree.applyOps(ODIN, "nope")).toThrow(BatchError);
    expect(tree.applyOps(ODIN, ops.slice(0, 5000)).rejected).toHaveLength(5000);
  });
});

describe("changesSince", () => {
  it("returns the user's nodes changed after a revision, deleted ones included", () => {
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    apply([
      { op: "create", id: a, parentId: null, rank: "a0", content: "A" },
      { op: "create", id: b, parentId: null, rank: "a1", content: "B" },
    ]);
    apply([{ op: "create", id: c, parentId: null, rank: "a0", content: "Freya's" }], FREYA);
    apply([{ op: "delete", id: b }]);

    const changes = tree.changesSince(ODIN, 2);
    expect(changes).toMatchObject({ rev: 3, nodes: [{ id: b, deletedAt: expect.any(String) }] });
    expect(tree.changesSince(ODIN, 0)).toMatchObject({ rev: 3, nodes: [{ id: a }, { id: b }] });
    expect(tree.changesSince(FREYA, 0)).toMatchObject({ rev: 3, nodes: [{ id: c }] });
  });

  it("includes a restored node's whole subtree", () => {
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    apply([
      { op: "create", id: a, parentId: null, rank: "a0", content: "A" },
      { op: "create", id: b, parentId: a, rank: "a0", content: "B" },
      { op: "create", id: c, parentId: b, rank: "a0", content: "C" },
    ]);
    apply([{ op: "delete", id: a }]);
    expect(tree.load(ODIN).nodes).toEqual([]);
    apply([{ op: "restore", id: a }]);
    const changes = tree.changesSince(ODIN, 2);
    expect(changes.reset ? [] : changes.nodes.map((n) => n.content).sort()).toEqual(["A", "B", "C"]);
  });

  it("asks for a reset after a purge, and the purge removes whole subtrees", () => {
    const [a, b, keep] = [randomUUID(), randomUUID(), randomUUID()];
    apply([
      { op: "create", id: a, parentId: null, rank: "a0", content: "A" },
      { op: "create", id: b, parentId: a, rank: "a0", content: "B" },
      { op: "create", id: keep, parentId: null, rank: "a1", content: "keep" },
    ]);
    apply([{ op: "delete", id: a }]);
    expect(tree.purge()).toBe(0); // deleted just now

    const in31Days = new Date(Date.now() + 31 * 86_400_000);
    expect(tree.purge(in31Days)).toBe(1);
    expect(tree.changesSince(ODIN, 2)).toEqual({ reset: true });
    expect(tree.changesSince(ODIN, tree.currentRev())).toEqual({ rev: tree.currentRev(), nodes: [] });
    // B went with A: it can no longer be restored or updated.
    expect(apply([{ op: "update", id: b, content: "x" }]).rejected).toEqual([{ index: 0, reason: "unknown node" }]);
    expect(visible()).toBe("keep");
  });
});

describe("removeUnknownOwners", () => {
  it("deletes every bullet of users no longer in Heimdall, and nobody else's", () => {
    const [a, b, c, f1, f2, f3] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    apply([
      { op: "create", id: a, parentId: null, rank: "a0", content: "A" },
      { op: "create", id: b, parentId: a, rank: "a0", content: "B" },
      { op: "create", id: c, parentId: null, rank: "a1", content: "C" },
    ]);
    apply([{ op: "delete", id: c }]);
    apply(
      [
        { op: "create", id: f1, parentId: null, rank: "a0", content: "F1" },
        { op: "create", id: f2, parentId: f1, rank: "a0", content: "F2" },
        { op: "create", id: f3, parentId: null, rank: "a1", content: "F3" },
      ],
      FREYA,
    );
    apply([{ op: "delete", id: f3 }], FREYA);
    const rev = tree.currentRev();

    expect(tree.removeUnknownOwners(new Set([ODIN]))).toEqual([{ owner: FREYA, rows: 3 }]);
    expect(visible(FREYA)).toBe("");
    expect(tree.changesSince(FREYA, 0)).toEqual({ rev, nodes: [] });
    expect(visible()).toBe("A(B)");
    expect(apply([{ op: "restore", id: c }]).rejected).toEqual([]);
    expect(tree.removeUnknownOwners(new Set([ODIN]))).toEqual([]);
  });
});
