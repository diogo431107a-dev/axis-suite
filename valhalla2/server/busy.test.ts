import { describe, expect, it } from "vitest";
import { createBusy } from "./busy.ts";

describe("one reply at a time", () => {
  it("refuses a second send to the same conversation until the first is done", () => {
    const busy = createBusy();
    const release = busy.claim("odin", "conv-0001");
    expect(() => busy.claim("odin", "conv-0001")).toThrow(expect.objectContaining({ status: 409, code: "busy" }));
    // Someone else's conversation, or another of yours, is not held up.
    busy.claim("freya", "conv-0001")();
    busy.claim("odin", "conv-0002")();
    release();
    busy.claim("odin", "conv-0001")();
  });
});
