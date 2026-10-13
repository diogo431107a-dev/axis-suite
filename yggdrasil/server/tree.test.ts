import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Node, Op } from "../shared/protocol.ts";
import { openDatabase } from "./db.ts";
import { AccessError, BatchError, createTree, type Tree } from "./tree.ts";

let tree: Tree;
beforeEach(() => {
  tree = createTree(openDatabase(":memory:"));
});

const ODIN = "odin";
const FREYA = "freya";
const THOR = "thor";
const USERS = new Set([ODIN, FREYA, THOR]);
const NO_SHARES = { byMe: [], withMe: [] };

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
    expect(tree.changesSince(ODIN, 1)).toEqual({ rev: 1, nodes: [], shares: NO_SHARES });
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
    expect(tree.changesSince(ODIN, tree.currentRev())).toEqual({
      rev: tree.currentRev(),
      nodes: [],
      shares: NO_SHARES,
    });
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
    expect(tree.changesSince(FREYA, 0)).toEqual({ rev, nodes: [], shares: NO_SHARES });
    expect(visible()).toBe("A(B)");
    expect(apply([{ op: "restore", id: c }]).rejected).toEqual([]);
    expect(tree.removeUnknownOwners(new Set([ODIN]))).toEqual([]);
  });
});

describe("sharing", () => {
  // Odin's tree: Home(Shared(One(Deep) Two) Private)
  let ids: Record<"home" | "shared" | "one" | "deep" | "two" | "private", string>;
  beforeEach(() => {
    ids = {
      home: randomUUID(),
      shared: randomUUID(),
      one: randomUUID(),
      deep: randomUUID(),
      two: randomUUID(),
      private: randomUUID(),
    };
    apply([
      { op: "create", id: ids.home, parentId: null, rank: "a0", content: "Home" },
      { op: "create", id: ids.shared, parentId: ids.home, rank: "a0", content: "Shared" },
      { op: "create", id: ids.one, parentId: ids.shared, rank: "a0", content: "One" },
      { op: "create", id: ids.deep, parentId: ids.one, rank: "a0", content: "Deep" },
      { op: "create", id: ids.two, parentId: ids.shared, rank: "a1", content: "Two" },
      { op: "create", id: ids.private, parentId: ids.home, rank: "a1", content: "Private" },
    ]);
  });
  const share = (permission: "read" | "write", username = FREYA, notify?: Set<string>) =>
    tree.setShares(ODIN, ids.shared, [{ username, permission }], USERS, notify);
  const freyaNode = (id: string) => tree.load(FREYA).nodes.find((n) => n.id === id);
  const READ_ONLY = "shared with you to read only";
  const OWNER_ONLY = "only its owner can move or delete this bullet";
  const OTHER_TREE = "a bullet can't move between two people's outlines";

  it("shows the recipient the shared bullet and everything under it, without its parent", () => {
    const notify = new Set<string>();
    expect(share("read", FREYA, notify)).toEqual([{ username: FREYA, permission: "read" }]);
    expect(notify).toEqual(new Set([ODIN, FREYA]));
    const freya = tree.load(FREYA);
    expect(shape(freya.nodes)).toBe("Shared(One(Deep) Two)");
    expect(freya.shares).toEqual({ byMe: [], withMe: [{ id: ids.shared, owner: ODIN, permission: "read" }] });
    expect(tree.load(ODIN).shares).toEqual({
      byMe: [{ id: ids.shared, shares: [{ username: FREYA, permission: "read" }] }],
      withMe: [],
    });
    expect(tree.shares(ODIN, ids.shared)).toEqual([{ username: FREYA, permission: "read" }]);
    expect(visible(THOR)).toBe("");
  });

  it("checks the share list and who may change it", () => {
    const set = (list: unknown, known: ReadonlySet<string> | null = USERS) =>
      tree.setShares(ODIN, ids.shared, list, known);
    expect(() => set([{ username: "loki", permission: "read" }])).toThrow("Not a user: loki");
    expect(() => set([{ username: ODIN, permission: "read" }])).toThrow(AccessError);
    expect(() => set([{ username: FREYA, permission: "all" }])).toThrow(AccessError);
    expect(() => set([], null)).toThrow(AccessError);
    share("write");
    // Freya can see it but not share it; Thor can't see it at all.
    expect(() => tree.setShares(FREYA, ids.shared, [], USERS)).toThrow("Only its owner can share this bullet");
    expect(() => tree.setShares(THOR, ids.shared, [], USERS)).toThrow("No such bullet");
    expect(() => tree.removeShare(THOR, ids.shared, FREYA)).toThrow("No such bullet");
    expect(() => tree.removeShare(FREYA, ids.shared, THOR)).toThrow(AccessError);
  });

  it("lets a reader collapse and star for themselves, and nothing else", () => {
    share("read");
    const result = apply(
      [
        { op: "update", id: ids.one, content: "changed" },
        { op: "update", id: ids.one, completedAt: "2026-10-13T08:00:00.000Z" },
        { op: "create", id: randomUUID(), parentId: ids.one, rank: "a1", content: "new" },
        { op: "move", id: ids.two, parentId: ids.one, rank: "a1" },
        { op: "delete", id: ids.two },
        { op: "update", id: ids.one, collapsed: true, starred: true },
      ],
      FREYA,
    );
    expect(result.rejected.map((r) => r.reason)).toEqual(Array(5).fill(READ_ONLY));
    expect(result.rev).not.toBeNull();
    expect(freyaNode(ids.one)).toMatchObject({ content: "One", collapsed: true, starred: true });
    const odinOne = tree.load(ODIN).nodes.find((n) => n.id === ids.one)!;
    expect(odinOne).toMatchObject({ collapsed: false, starred: false });
  });

  it("follows the owner's collapsing until the recipient collapses for themselves", () => {
    share("read");
    apply([{ op: "update", id: ids.one, collapsed: true, starred: true }]);
    expect(freyaNode(ids.one)).toMatchObject({ collapsed: true, starred: false });
    apply([{ op: "update", id: ids.one, starred: true }], FREYA);
    apply([{ op: "update", id: ids.one, collapsed: false }]);
    expect(freyaNode(ids.one)).toMatchObject({ collapsed: false, starred: true });
    apply([{ op: "update", id: ids.one, collapsed: true }], FREYA);
    apply([{ op: "update", id: ids.one, collapsed: false }]);
    expect(freyaNode(ids.one)).toMatchObject({ collapsed: true });
  });

  it("lets an editor change what is inside, as the owner's bullets", () => {
    share("write");
    const added = randomUUID();
    const notify = new Set<string>();
    const result = tree.applyOps(
      FREYA,
      [
        { op: "update", id: ids.shared, content: "Shared!" },
        { op: "create", id: added, parentId: ids.two, rank: "a0", content: "Added" },
        { op: "move", id: ids.deep, parentId: ids.two, rank: "a1" },
        { op: "delete", id: ids.one },
      ],
      notify,
    );
    expect(result.rejected).toEqual([]);
    expect(notify).toEqual(new Set([FREYA, ODIN]));
    expect(visible(ODIN)).toBe("Home(Shared!(Two(Added Deep)) Private)");
    expect(visible(FREYA)).toBe("Shared!(Two(Added Deep))");
    // Added is Odin's: it stays when Freya leaves Heimdall.
    tree.removeUnknownOwners(new Set([ODIN, THOR]));
    expect(visible(ODIN)).toBe("Home(Shared!(Two(Added Deep)) Private)");
  });

  it("lets an editor restore what they deleted, and send a create again", () => {
    share("write");
    const added = randomUUID();
    apply([{ op: "create", id: added, parentId: ids.two, rank: "a0", content: "Added" }], FREYA);
    apply([{ op: "delete", id: ids.one }], FREYA);
    expect(apply([{ op: "restore", id: ids.one }], FREYA).rejected).toEqual([]);
    // A create sent again is left alone, not refused.
    expect(apply([{ op: "create", id: added, parentId: ids.two, rank: "a0" }], FREYA)).toEqual({
      rev: null,
      rejected: [],
    });
    expect(visible(FREYA)).toBe("Shared(One(Deep) Two(Added))");
  });

  it("keeps the shared bullet itself, and the rest of the owner's tree, out of an editor's reach", () => {
    share("write");
    const mine = randomUUID();
    apply([{ op: "create", id: mine, parentId: null, rank: "Z0", content: "Mine" }], FREYA);
    const result = apply(
      [
        { op: "move", id: ids.shared, parentId: ids.private, rank: "a0" },
        { op: "delete", id: ids.shared },
        { op: "move", id: ids.one, parentId: ids.private, rank: "a0" },
        { op: "move", id: ids.one, parentId: mine, rank: "a0" },
        { op: "move", id: mine, parentId: ids.one, rank: "a0" },
        { op: "move", id: ids.one, parentId: null, rank: "a0" },
        { op: "update", id: ids.private, content: "x" },
        { op: "create", id: randomUUID(), parentId: ids.home, rank: "a2" },
      ],
      FREYA,
    );
    expect(result.rejected.map((r) => r.reason)).toEqual([
      OWNER_ONLY,
      OWNER_ONLY,
      "unknown parent",
      OTHER_TREE,
      OTHER_TREE,
      OTHER_TREE,
      "unknown node",
      "unknown parent",
    ]);
    expect(visible(ODIN)).toBe("Home(Shared(One(Deep) Two) Private)");
    expect(visible(FREYA)).toBe("Mine Shared(One(Deep) Two)");
  });

  it("sends the recipient changes inside the shared bullet only, as they see them", () => {
    share("read");
    const since = tree.currentRev();
    apply([
      { op: "update", id: ids.deep, content: "Deep!" },
      { op: "update", id: ids.private, content: "Private!" },
      { op: "update", id: ids.shared, content: "Shared!" },
    ]);
    const changes = tree.changesSince(FREYA, since);
    if (changes.reset) throw new Error("unexpected reset");
    expect(changes.nodes.map((n) => n.content).sort()).toEqual(["Deep!", "Shared!"]);
    expect(changes.nodes.find((n) => n.id === ids.shared)!.parentId).toBeNull();
    // Her own view changes come too.
    const before = tree.currentRev();
    apply([{ op: "update", id: ids.two, starred: true }], FREYA);
    const mine = tree.changesSince(FREYA, before);
    expect(mine.reset ? [] : mine.nodes.map((n) => [n.content, n.starred])).toEqual([["Two", true]]);
  });

  it("reloads the recipient when what they may see changes", () => {
    const since = tree.currentRev();
    share("read");
    expect(tree.changesSince(FREYA, since)).toEqual({ reset: true });
    expect(tree.changesSince(ODIN, since)).toMatchObject({ nodes: [] });

    // Moving a bullet out of (or into) the shared one.
    let at = tree.currentRev();
    const notify = new Set<string>();
    tree.applyOps(ODIN, [{ op: "move", id: ids.two, parentId: ids.private, rank: "a0" }], notify);
    expect(notify).toEqual(new Set([ODIN, FREYA]));
    expect(tree.changesSince(FREYA, at)).toEqual({ reset: true });
    expect(visible(FREYA)).toBe("Shared(One(Deep))");
    at = tree.currentRev();
    apply([{ op: "move", id: ids.two, parentId: ids.one, rank: "a1" }]);
    expect(tree.changesSince(FREYA, at)).toEqual({ reset: true });
    expect(visible(FREYA)).toBe("Shared(One(Deep Two))");
    // Moving inside it doesn't.
    at = tree.currentRev();
    apply([{ op: "move", id: ids.two, parentId: ids.shared, rank: "a1" }]);
    expect(tree.changesSince(FREYA, at)).toMatchObject({ nodes: [{ id: ids.two }] });

    // Deleting something above it, then restoring it.
    at = tree.currentRev();
    apply([{ op: "delete", id: ids.home }]);
    expect(tree.changesSince(FREYA, at)).toEqual({ reset: true });
    expect(tree.load(FREYA)).toMatchObject({ nodes: [], shares: NO_SHARES });
    expect(apply([{ op: "update", id: ids.one, collapsed: true }], FREYA).rejected).toHaveLength(1);
    apply([{ op: "restore", id: ids.home }]);
    expect(visible(FREYA)).toBe("Shared(One(Deep) Two)");

    // Taking it off her list.
    at = tree.currentRev();
    const removed = new Set<string>();
    tree.removeShare(FREYA, ids.shared, FREYA, removed);
    expect(removed).toEqual(new Set([ODIN, FREYA]));
    expect(tree.changesSince(FREYA, at)).toEqual({ reset: true });
    expect(visible(FREYA)).toBe("");
    expect(() => tree.removeShare(FREYA, ids.shared, FREYA)).toThrow("No such bullet");
  });

  it("gives nested shares the better permission, and lists only the outer one at the top", () => {
    share("read");
    tree.setShares(ODIN, ids.one, [{ username: FREYA, permission: "write" }], USERS);
    const freya = tree.load(FREYA);
    expect(shape(freya.nodes)).toBe("Shared(One(Deep) Two)");
    expect(freya.shares.withMe.map((s) => s.permission).sort()).toEqual(["read", "write"]);
    const result = apply(
      [
        { op: "update", id: ids.deep, content: "Deep!" },
        { op: "update", id: ids.two, content: "Two!" },
      ],
      FREYA,
    );
    expect(result.rejected).toEqual([{ index: 1, reason: READ_ONLY }]);
  });

  it("stops sharing with users no longer in Heimdall", () => {
    share("write", THOR);
    apply([{ op: "update", id: ids.one, starred: true }], THOR);
    tree.removeUnknownOwners(new Set([ODIN, FREYA]));
    expect(tree.load(ODIN).shares).toEqual(NO_SHARES);
  });

  it("takes an editor's batch of 5,000 bullets quickly", () => {
    share("write");
    const ops: Op[] = [];
    let parent = ids.two;
    for (let i = 0; i < 5000; i++) {
      const id = randomUUID();
      ops.push({ op: "create", id, parentId: parent, rank: "a0", content: `n${i}` });
      if (i % 50 === 0) parent = id;
    }
    const started = performance.now();
    expect(apply(ops, FREYA).rejected).toEqual([]);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(tree.load(FREYA).nodes).toHaveLength(5004);
  });
});
