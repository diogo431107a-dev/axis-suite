import { describe, expect, it } from "vitest";
import type { Node, Op, Shares } from "../../shared/protocol.ts";
import { READ_ONLY, refusal } from "./outliner.ts";
import { Store, newNode } from "./store.ts";

const node = (id: string, parentId: string | null, rank = "a0", fields: Partial<Node> = {}): Node => ({
  ...newNode(id, parentId, rank),
  content: id,
  ...fields,
});

// The user's own "mine", and "shared" (with "inside" and "deeper") from Odin, read only, with
// "deeper" also shared to edit.
const SHARES: Shares = {
  byMe: [{ id: "mine", shares: [{ username: "freya", permission: "write" }] }],
  withMe: [
    { id: "shared", owner: "odin", permission: "read" },
    { id: "deeper", owner: "odin", permission: "write" },
  ],
};

function store(): Store {
  const s = new Store();
  s.load(
    [
      node("mine", null, "a0"),
      node("shared", null, "a1"),
      node("inside", "shared"),
      node("deeper", "inside"),
      node("new-top", null, "a2"),
    ],
    SHARES,
  );
  return s;
}

describe("Store with shared bullets", () => {
  it("keeps the bullets shared with the user out of their own top level", () => {
    const s = store();
    expect(s.children(null)).toEqual(["mine", "new-top"]);
    expect(s.sharedRoots()).toEqual(["shared"]);
    expect(s.children("shared")).toEqual(["inside"]);
    expect(s.sharesOf("mine")).toEqual([{ username: "freya", permission: "write" }]);
    expect(s.sharedByMe()).toEqual(["mine"]);
  });

  it("knows the user's role anywhere, the better permission winning", () => {
    const s = store();
    expect(s.roleOf("mine")).toBe("owner");
    expect(s.roleOf(null)).toBe("owner");
    expect(s.roleOf("shared")).toBe("viewer");
    expect(s.roleOf("inside")).toBe("viewer");
    expect(s.roleOf("deeper")).toBe("editor");
    expect(s.roleOf("made-now", new Map([["made-now", "inside"]]))).toBe("viewer");
  });

  it("sorts the bullets out again when what is shared with the user changes", () => {
    const s = store();
    expect(s.setShares(SHARES)).toBe(false);
    expect(s.setShares({ byMe: [], withMe: [{ id: "new-top", owner: "thor", permission: "write" }] })).toBe(true);
    expect(s.children(null)).toEqual(["mine", "shared"]);
    expect(s.sharedRoots()).toEqual(["new-top"]);
    expect(s.roleOf("inside")).toBe("owner");
  });

  it("keeps a shared bullet apart when it changes", () => {
    const s = store();
    s.applyAll([{ op: "update", id: "shared", content: "renamed" }]);
    s.applyRemote({ ...s.get("shared")!, completedAt: "2026-10-13T08:00:00.000Z" }, new Set());
    expect(s.children(null)).toEqual(["mine", "new-top"]);
    expect(s.sharedRoots()).toEqual(["shared"]);
  });
});

describe("refusal", () => {
  const s = store();
  const check = (ops: Op[]) =>
    refusal(
      ops,
      (id, parents) => s.roleOf(id, parents),
      (id) => s.get(id)?.parentId === null && s.sharedWithMe(id) !== undefined,
    );

  it("lets a reader collapse and star, and nothing else", () => {
    expect(check([{ op: "update", id: "inside", collapsed: true, starred: true }])).toBeNull();
    expect(check([{ op: "update", id: "inside", content: "x" }])).toBe(READ_ONLY);
    expect(check([{ op: "update", id: "inside", completedAt: "2026-10-13T08:00:00.000Z" }])).toBe(READ_ONLY);
    expect(check([{ op: "create", id: "n", parentId: "inside", rank: "a1" }])).toBe(READ_ONLY);
    expect(check([{ op: "delete", id: "inside" }])).toBe(READ_ONLY);
    expect(check([{ op: "move", id: "deeper", parentId: "inside", rank: "a1" }])).toBe(READ_ONLY);
  });

  it("lets an editor change what is inside, but not move or delete the shared bullet itself", () => {
    expect(
      check([
        { op: "create", id: "n", parentId: "deeper", rank: "a0" },
        { op: "create", id: "m", parentId: "n", rank: "a0" },
        { op: "update", id: "deeper", content: "x" },
      ]),
    ).toBeNull();
    expect(check([{ op: "update", id: "mine", content: "mine" }])).toBeNull();
    s.setShares({ byMe: [], withMe: [{ id: "shared", owner: "odin", permission: "write" }] });
    expect(check([{ op: "update", id: "shared", content: "x" }])).toBeNull();
    expect(check([{ op: "delete", id: "shared" }])).toMatch(/Only its owner/);
    expect(check([{ op: "move", id: "shared", parentId: null, rank: "b0" }])).toMatch(/Only its owner/);
  });
});
