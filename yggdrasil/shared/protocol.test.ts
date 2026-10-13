import { describe, expect, it } from "vitest";
import { compareSiblings, fileIdsIn, parseOp } from "./protocol.ts";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const PARENT = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

describe("parseOp", () => {
  it("accepts each kind of op and keeps only known keys", () => {
    expect(parseOp({ op: "create", id: ID, parentId: null, rank: "a0", content: "x", extra: 1 })).toEqual({
      op: "create",
      id: ID,
      parentId: null,
      rank: "a0",
      content: "x",
    });
    expect(parseOp({ op: "update", id: ID, completedAt: "2026-10-11T10:00:00.000Z", starred: true })).toEqual({
      op: "update",
      id: ID,
      completedAt: "2026-10-11T10:00:00.000Z",
      starred: true,
    });
    expect(parseOp({ op: "move", id: ID, parentId: PARENT, rank: "a1" })).toEqual({
      op: "move",
      id: ID,
      parentId: PARENT,
      rank: "a1",
    });
    expect(parseOp({ op: "delete", id: ID })).toEqual({ op: "delete", id: ID });
    expect(parseOp({ op: "restore", id: ID })).toEqual({ op: "restore", id: ID });
  });

  it("refuses bad ids, ranks and fields", () => {
    expect(parseOp({ op: "delete", id: "1" })).toBe("id must be a UUID");
    expect(parseOp({ op: "move", id: ID, parentId: "x", rank: "a0" })).toBe("parentId must be a UUID or null");
    expect(parseOp({ op: "move", id: ID, parentId: null, rank: "a 0" })).toBe("invalid rank");
    expect(parseOp({ op: "update", id: ID, content: 5 })).toBe("content must be a string");
    expect(parseOp({ op: "update", id: ID, note: "x".repeat(100_001) })).toMatch(/longer than/);
    expect(parseOp({ op: "update", id: ID, completedAt: "yesterday" })).toMatch(/timestamp/);
    expect(parseOp({ op: "update", id: ID, collapsed: 1 })).toMatch(/true or false/);
    expect(parseOp({ op: "explode", id: ID })).toBe("unknown op");
    expect(parseOp(null)).toBe("not an object");
  });
});

describe("compareSiblings", () => {
  it("orders by rank, then id, by code unit", () => {
    const list = [
      { rank: "a1", id: "b" },
      { rank: "Zz", id: "z" },
      { rank: "a1", id: "a" },
      { rank: "a0V", id: "c" },
    ];
    expect(list.sort(compareSiblings).map((n) => n.id)).toEqual(["z", "c", "a", "b"]);
  });
});

describe("fileIdsIn", () => {
  it("finds every file a text refers to, once each", () => {
    const text = `![a](/api/files/${ID}) [b](/API/FILES/${ID.toUpperCase()}) [c](/api/files/${PARENT})`;
    expect(fileIdsIn(text)).toEqual([ID, PARENT]);
    expect(fileIdsIn(`/api/files/not-an-id ${ID}`)).toEqual([]);
  });
});
