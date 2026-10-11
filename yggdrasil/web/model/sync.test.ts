import { describe, expect, it } from "vitest";
import type { Op } from "../../shared/protocol.ts";
import { enqueue, guardedParts, takeBatch } from "./sync.ts";

describe("enqueue", () => {
  it("folds typing into the node's last create or update", () => {
    const queue: Op[] = [];
    enqueue(queue, { op: "create", id: "a", parentId: null, rank: "a0" });
    enqueue(queue, { op: "update", id: "b", content: "other" });
    enqueue(queue, { op: "update", id: "a", content: "H" });
    enqueue(queue, { op: "update", id: "a", content: "Hi" });
    enqueue(queue, { op: "update", id: "b", starred: true });
    expect(queue).toEqual([
      { op: "create", id: "a", parentId: null, rank: "a0", content: "Hi" },
      { op: "update", id: "b", content: "other", starred: true },
    ]);
  });

  it("keeps an update after a delete, move or restore of the same node in order", () => {
    const queue: Op[] = [
      { op: "update", id: "a", content: "x" },
      { op: "delete", id: "a" },
    ];
    enqueue(queue, { op: "update", id: "a", content: "y" });
    expect(queue).toHaveLength(3);
  });
});

describe("takeBatch", () => {
  it("takes at most 2,000 ops", () => {
    const queue: Op[] = Array.from({ length: 4500 }, (_, i) => ({ op: "delete", id: String(i) }));
    expect(takeBatch(queue)).toHaveLength(2000);
    expect(queue).toHaveLength(2500);
  });

  it("keeps a batch under 4 MB, but always takes one op", () => {
    const big = "x".repeat(1_500_000);
    const queue: Op[] = Array.from({ length: 4 }, (_, i) => ({ op: "update", id: String(i), note: big }));
    expect(takeBatch(queue)).toHaveLength(2);
    const huge: Op[] = [{ op: "update", id: "h", note: "x".repeat(5_000_000) }];
    expect(takeBatch(huge)).toHaveLength(1);
  });
});

describe("guardedParts", () => {
  it("names what each pending op changes", () => {
    const parts = guardedParts([
      { op: "update", id: "a", content: "x", completedAt: null },
      { op: "move", id: "a", parentId: null, rank: "a0" },
      { op: "delete", id: "b" },
    ]);
    expect([...parts.get("a")!].sort()).toEqual(["completedAt", "content", "place"]);
    expect([...parts.get("b")!]).toEqual(["deletedAt"]);
  });
});
