import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { generateNKeysBetween } from "fractional-indexing";
import { LIMITS, type ExportFile, type MapData, type Op, type Side } from "../shared/protocol.ts";
import { openDatabase } from "./db.ts";
import { StoreError } from "./errors.ts";
import { createMaps, type Maps } from "./maps.ts";

/** The StoreError a call throws (fails the test if it doesn't throw one). */
function refusal(fn: () => unknown): StoreError {
  try {
    fn();
  } catch (err) {
    if (err instanceof StoreError) return err;
    throw err;
  }
  throw new Error("expected a StoreError");
}

let db: DatabaseSync;
let maps: Maps;
let map: MapData;
let root: string;

beforeEach(() => {
  db = openDatabase(":memory:");
  maps = createMaps(db);
  map = maps.create("odin", { text: "Plans" });
  root = map.nodes[0]!.id;
});

const apply = (ops: Op[], owner = "odin", mapId = map.map.id) => maps.applyOps(owner, mapId, { ops });

/** A create of a new node; its id is returned with it. */
function create(parentId: string, text: string, side: Side | null = null, rank = "a0"): [Op, string] {
  const id = randomUUID();
  return [{ op: "create", id, parentId, rank, side, text }, id];
}

/** The live tree of a map as indented text: "Plans\n  [right] Work\n    Mail". */
function outline(owner = "odin", mapId = map.map.id): string {
  const data = maps.load(owner, mapId);
  const kids = new Map<string | null, typeof data.nodes>();
  for (const n of data.nodes) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
  const lines: string[] = [];
  const walk = (id: string | null, depth: number) => {
    const list = (kids.get(id) ?? []).sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
    for (const n of list) {
      lines.push(`${"  ".repeat(depth)}${n.side ? `[${n.side}] ` : ""}${n.text}`);
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return lines.join("\n");
}

describe("maps", () => {
  it("creates a map with its root, named after the root's first line", () => {
    expect(map.nodes).toHaveLength(1);
    expect(map.nodes[0]).toMatchObject({ parentId: null, side: null, text: "Plans" });
    apply([{ op: "update", id: root, text: "Holidays 2027\nand more" }]);
    expect(maps.list("odin").map((m) => m.name)).toEqual(["Holidays 2027"]);
    maps.create("odin", {});
    expect(maps.list("odin").map((m) => m.name)).toEqual(["Holidays 2027", "Untitled map"]);
  });

  it("keeps each user's maps to themselves", () => {
    expect(maps.list("freya")).toEqual([]);
    expect(refusal(() => maps.load("freya", map.map.id)).status).toBe(404);
    expect(refusal(() => apply([], "freya")).status).toBe(404);
    expect(refusal(() => maps.remove("freya", map.map.id)).status).toBe(404);
    expect(refusal(() => maps.changes("freya", map.map.id, 0)).status).toBe(404);
    expect(refusal(() => maps.exportMaps("freya", map.map.id)).status).toBe(404);
  });

  it("reorders maps in the sidebar", () => {
    const b = maps.create("odin", { text: "B" }).map.id;
    const c = maps.create("odin", { text: "C" }).map.id;
    expect(maps.move("odin", c, { afterId: null }).map((m) => m.name)).toEqual(["C", "Plans", "B"]);
    expect(maps.move("odin", map.map.id, { afterId: b }).map((m) => m.name)).toEqual(["C", "B", "Plans"]);
    expect(refusal(() => maps.move("odin", c, { afterId: c })).status).toBe(400);
  });

  it("deletes a map with a branch 2,000 levels deep", () => {
    let parent = root;
    const ops: Op[] = [];
    for (let i = 0; i < 2_000; i++) {
      const [op, id] = create(parent, `level ${i}`, i === 0 ? "right" : null);
      ops.push(op);
      parent = id;
    }
    expect(apply(ops).rejected).toEqual([]);
    maps.remove("odin", map.map.id);
    expect(maps.list("odin")).toEqual([]);
    expect(db.prepare("SELECT count(*) AS n FROM nodes").get()).toEqual({ n: 0 });
  });

  it("refuses more maps than the limit", () => {
    for (let i = 1; i < LIMITS.maps; i++) maps.create("odin", {});
    expect(refusal(() => maps.create("odin", {})).code).toBe("too-many");
  });
});

describe("ops", () => {
  it("adds, edits, moves, deletes and restores nodes", () => {
    const [a, work] = create(root, "Work", "right", "a1");
    const [b, home] = create(root, "Home", "left", "a0");
    const [c, mail] = create(work, "Mail");
    expect(apply([a, b, c])).toEqual({ rev: 1, rejected: [] });
    expect(outline()).toBe("Plans\n  [left] Home\n  [right] Work\n    Mail");

    expect(apply([{ op: "move", id: mail, parentId: home, rank: "a0", side: null }]).rev).toBe(2);
    expect(apply([{ op: "update", id: work, text: "Job", collapsed: true }]).rev).toBe(3);
    expect(outline()).toBe("Plans\n  [left] Home\n    Mail\n  [right] Job");
    expect(maps.load("odin", map.map.id).nodes.find((n) => n.id === work)?.collapsed).toBe(true);

    apply([{ op: "delete", id: home }]);
    expect(outline()).toBe("Plans\n  [right] Job");
    apply([{ op: "restore", id: home }]);
    expect(outline()).toBe("Plans\n  [left] Home\n    Mail\n  [right] Job");
  });

  it("can apply the same batch twice", () => {
    const [a] = create(root, "Work", "right");
    expect(apply([a]).rev).toBe(1);
    expect(apply([a])).toEqual({ rev: null, rejected: [] });
    expect(apply([{ op: "update", id: a.id, text: "Work" }]).rev).toBe(null);
  });

  it("gives main branches a side and no other node one", () => {
    const [a, work] = create(root, "Work", "right");
    apply([a]);
    const [noSide] = create(root, "No side", null);
    const [sided] = create(work, "Sided", "left");
    expect(apply([noSide, sided]).rejected.map((r) => r.reason)).toEqual([
      "a main branch needs a side",
      "only main branches have a side",
    ]);
    expect(apply([{ op: "move", id: work, parentId: root, rank: "a1", side: "left" }]).rejected).toEqual([]);
    expect(outline()).toBe("Plans\n  [left] Work");
  });

  it("keeps the centre in place", () => {
    const [a, work] = create(root, "Work", "right");
    apply([a]);
    const reasons = apply([
      { op: "move", id: root, parentId: work, rank: "a0", side: null },
      { op: "delete", id: root },
      { op: "update", id: root, collapsed: true },
    ]).rejected.map((r) => r.reason);
    expect(reasons).toEqual([
      "the centre of a map can't be moved or deleted",
      "the centre of a map can't be moved or deleted",
      "the centre of a map can't be folded",
    ]);
  });

  it("refuses to put a node inside itself", () => {
    const [a, work] = create(root, "Work", "right");
    const [b, mail] = create(work, "Mail");
    apply([a, b]);
    expect(apply([{ op: "move", id: work, parentId: mail, rank: "a0", side: null }]).rejected[0]?.reason).toBe(
      "would put a node inside itself",
    );
  });

  it("keeps nodes and arrows inside their map", () => {
    const other = maps.create("odin", { text: "Other" });
    const otherRoot = other.nodes[0]!.id;
    const [a, work] = create(root, "Work", "right");
    apply([a]);
    const reasons = apply(
      [
        { op: "create", id: work, parentId: otherRoot, rank: "a0", side: "right" },
        { op: "update", id: work, text: "stolen" },
        { op: "move", id: work, parentId: otherRoot, rank: "a0", side: "right" },
        { op: "createArrow", id: randomUUID(), fromId: work, toId: otherRoot },
      ],
      "odin",
      other.map.id,
    ).rejected.map((r) => r.reason);
    expect(reasons).toEqual(["id already in use", "unknown node", "unknown node", "unknown node"]);
  });

  it("adds, labels, deletes and restores arrows", () => {
    const [a, work] = create(root, "Work", "right");
    const [b, home] = create(root, "Home", "left");
    const arrow = randomUUID();
    apply([a, b, { op: "createArrow", id: arrow, fromId: work, toId: home, label: "pays for" }]);
    expect(maps.load("odin", map.map.id).arrows).toEqual([
      { id: arrow, fromId: work, toId: home, label: "pays for", deletedAt: null },
    ]);
    apply([{ op: "updateArrow", id: arrow, label: "funds" }]);
    expect(maps.load("odin", map.map.id).arrows[0]?.label).toBe("funds");
    apply([{ op: "deleteArrow", id: arrow }]);
    expect(maps.load("odin", map.map.id).arrows).toEqual([]);
    apply([{ op: "restoreArrow", id: arrow }]);
    expect(maps.load("odin", map.map.id).arrows).toHaveLength(1);
    const bad = apply([
      { op: "createArrow", id: randomUUID(), fromId: work, toId: work },
      { op: "updateArrow", id: arrow, label: "two\nlines" },
    ]).rejected.map((r) => r.reason);
    expect(bad).toEqual(["an arrow needs two different nodes", "label must be one line"]);
  });

  it("refuses more nodes than a map holds, counting deleted ones until they are purged", () => {
    const ranks = generateNKeysBetween(null, null, LIMITS.mapNodes);
    const ops = ranks.slice(0, LIMITS.mapNodes - 1).map((rank, i): Op => create(root, `n${i}`, "right", rank)[0]);
    for (let i = 0; i < ops.length; i += LIMITS.opsPerBatch) {
      expect(apply(ops.slice(i, i + LIMITS.opsPerBatch)).rejected).toEqual([]);
    }
    apply([{ op: "delete", id: ops[0]!.id }]);
    const [one] = create(root, "one too many", "left");
    expect(apply([one]).rejected[0]?.reason).toBe(`a map holds at most ${LIMITS.mapNodes} nodes`);
  });

  it("refuses text over the limit and malformed ops", () => {
    const [a] = create(root, "x".repeat(LIMITS.textChars + 1), "right");
    const reasons = apply([a, { op: "fly", id: randomUUID() } as unknown as Op]).rejected.map((r) => r.reason);
    expect(reasons).toEqual([`text is longer than ${LIMITS.textChars} characters`, "unknown op"]);
    expect(refusal(() => maps.applyOps("odin", map.map.id, { ops: "nope" })).status).toBe(400);
  });
});

describe("changes and purging", () => {
  it("lists what changed after a revision, deleted nodes included", () => {
    const [a, work] = create(root, "Work", "right");
    apply([a]);
    const [b] = create(work, "Mail");
    apply([b, { op: "delete", id: work }]);
    const changes = maps.changes("odin", map.map.id, 1);
    if (changes.reset) throw new Error("unexpected reset");
    expect(changes.rev).toBe(2);
    expect(changes.nodes.map((n) => n.text).sort()).toEqual(["Mail", "Work"]);
    expect(changes.nodes.find((n) => n.id === work)?.deletedAt).not.toBeNull();
  });

  it("purges branches deleted long ago, 2,000 levels deep, and makes older pages reload", () => {
    let parent = root;
    const ops: Op[] = [];
    for (let i = 0; i < 2_000; i++) {
      const [op, id] = create(parent, `level ${i}`, i === 0 ? "right" : null);
      ops.push(op);
      parent = id;
    }
    const top = ops[0]!.id;
    apply(ops);
    const arrow = randomUUID();
    apply([{ op: "createArrow", id: arrow, fromId: root, toId: parent }]);
    apply([{ op: "delete", id: top }]);
    const before = maps.load("odin", map.map.id).rev;

    expect(maps.purge(new Date())).toBe(0);
    expect(maps.purge(new Date(Date.now() + 31 * 86_400_000))).toBe(1);
    expect(db.prepare("SELECT count(*) AS n FROM nodes").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT count(*) AS n FROM arrows").get()).toEqual({ n: 0 });
    expect(maps.changes("odin", map.map.id, before)).toEqual({ reset: true });
    const after = maps.load("odin", map.map.id).rev;
    expect(after).toBe(before + 1);
    expect(maps.changes("odin", map.map.id, after)).toEqual({ rev: after, nodes: [], arrows: [] });
  });
});

describe("backup", () => {
  it("exports and restores maps as new ones, arrows included", () => {
    const [a, work] = create(root, "Work", "right", "a1");
    const [b, home] = create(root, "Home", "left", "a0");
    const [c, mail] = create(work, "Mail");
    const [d] = create(home, "Garden");
    apply([a, b, c, d, { op: "update", id: home, collapsed: true }]);
    apply([{ op: "createArrow", id: randomUUID(), fromId: mail, toId: home, label: "about" }]);

    const file = maps.exportMaps("odin");
    expect(file.maps[0]).toEqual({
      root: {
        text: "Plans",
        children: [
          { text: "Home", side: "left", collapsed: true, children: [{ text: "Garden" }] },
          { text: "Work", side: "right", children: [{ text: "Mail" }] },
        ],
      },
      arrows: [{ from: 4, to: 1, label: "about" }],
    });

    const result = maps.restore("freya", JSON.parse(JSON.stringify(file)));
    expect(result).toMatchObject({ maps: 1, nodes: 5, droppedArrows: 0 });
    expect(outline("freya", result.ids[0])).toBe(outline());
    const copy = maps.exportMaps("freya");
    expect(copy.maps).toEqual(file.maps);
  });

  it("gives main branches without a side the shorter side, and drops bad arrows", () => {
    const file: ExportFile = {
      format: "mimir",
      version: 1,
      exportedAt: "2026-10-13T00:00:00.000Z",
      maps: [
        {
          root: {
            text: "From OPML",
            children: [{ text: "A", children: [{ text: "a1" }, { text: "a2" }] }, { text: "B" }, { text: "C" }],
          },
          arrows: [
            { from: 1, to: 1 },
            { from: 0, to: 99 },
            { from: 2, to: 4, label: "x" },
          ],
        },
      ],
    };
    const result = maps.restore("odin", file);
    expect(result.droppedArrows).toBe(2);
    expect(outline("odin", result.ids[0])).toBe("From OPML\n  [right] A\n    a1\n    a2\n  [left] B\n  [left] C");
    expect(maps.load("odin", result.ids[0]!).arrows).toHaveLength(1);
  });

  it("refuses a file that isn't a backup, changing nothing", () => {
    expect(refusal(() => maps.restore("odin", { format: "valkyrie", version: 1, boards: [] })).status).toBe(400);
    const bad = { format: "mimir", version: 1, maps: [{ root: { text: "ok" } }, { root: { text: 5 } }] };
    expect(refusal(() => maps.restore("odin", bad)).message).toBe("Map 2: A node's text must be a string");
    expect(maps.list("odin")).toHaveLength(1);
  });
});

describe("removed users", () => {
  it("deletes the maps of owners Heimdall no longer knows", () => {
    maps.create("freya", { text: "Hers" });
    maps.create("freya", { text: "Hers too" });
    expect(maps.removeUnknownOwners(new Set(["odin"]))).toEqual([{ owner: "freya", maps: 2 }]);
    expect(maps.list("freya")).toEqual([]);
    expect(maps.list("odin")).toHaveLength(1);
  });
});
