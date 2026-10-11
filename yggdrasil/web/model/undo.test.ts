import { describe, expect, it } from "vitest";
import type { Op } from "../../shared/protocol.ts";
import { History, type Step } from "./undo.ts";

const typing = (content: string, old: string, at: number): Step => ({
  ops: [{ op: "update", id: "a", content }],
  inverse: [{ op: "update", id: "a", content: old }],
  before: null,
  after: null,
  mergeKey: "type:a",
  at,
});

describe("History", () => {
  it("merges typing in one bullet into one step, keeping the oldest value to undo to", () => {
    const h = new History();
    h.record(typing("H", "", 0));
    h.record(typing("Hi", "H", 400));
    h.record(typing("Hi!", "Hi", 1300));
    const step = h.popUndo()!;
    expect(step.ops).toEqual([{ op: "update", id: "a", content: "Hi!" }]);
    expect(step.inverse).toEqual([{ op: "update", id: "a", content: "" }]);
    expect(h.canUndo).toBe(false);
  });

  it("starts a new step after a pause of more than a second, or after seal()", () => {
    const h = new History();
    h.record(typing("H", "", 0));
    h.record(typing("Hi", "H", 1500));
    h.seal();
    h.record(typing("Hi!", "Hi", 1600));
    expect(h.popUndo()!.inverse).toEqual([{ op: "update", id: "a", content: "Hi" }]);
    expect(h.popUndo()!.inverse).toEqual([{ op: "update", id: "a", content: "H" }]);
    expect(h.popUndo()!.inverse).toEqual([{ op: "update", id: "a", content: "" }]);
  });

  it("clears redo when something new happens", () => {
    const h = new History();
    const op: Op = { op: "delete", id: "a" };
    h.record({ ops: [op], inverse: [{ op: "restore", id: "a" }], before: null, after: null, at: 0 });
    h.pushRedo(h.popUndo()!);
    expect(h.canRedo).toBe(true);
    h.record({ ops: [op], inverse: [{ op: "restore", id: "a" }], before: null, after: null, at: 1 });
    expect(h.canRedo).toBe(false);
  });
});
