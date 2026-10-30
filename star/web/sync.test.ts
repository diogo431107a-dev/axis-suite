import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Op, OpsRequest } from "../shared/protocol.ts";
import { Sync, type SyncEvents } from "./sync.ts";

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let sent: OpsRequest[];
let answers: (() => Response)[];
let events: { saved: Mock<SyncEvents["saved"]>; state: Mock<SyncEvents["state"]> } & {
  refused: Mock<SyncEvents["refused"]>;
  signedOut: Mock<SyncEvents["signedOut"]>;
};
let sync: Sync;

const remove = (id: string): Op => ({ op: "removeLink", id });

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  answers = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_path: string, init: RequestInit) => {
      sent.push(JSON.parse(init.body as string) as OpsRequest);
      const answer = answers.shift();
      return answer ? answer() : respond(200, { rev: sent.length });
    }),
  );
  vi.stubGlobal("location", { href: "https://star.example.com/" });
  events = { saved: vi.fn(), state: vi.fn(), refused: vi.fn(), signedOut: vi.fn() };
  sync = new Sync(events);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("saving", () => {
  it("collapses typing into one op, and waits for the typing to stop", async () => {
    sync.push({ op: "updateStar", id: "a", name: "B" });
    await vi.advanceTimersByTimeAsync(300);
    sync.push({ op: "updateStar", id: "a", name: "Bo" });
    sync.push({ op: "updateStar", id: "a", memo: "Neighbor" });
    await vi.advanceTimersByTimeAsync(400);
    expect(sent).toEqual([]);
    expect(sync.idle).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.ops).toEqual([{ op: "updateStar", id: "a", name: "Bo", memo: "Neighbor" }]);
    expect(sync.idle).toBe(true);
    expect(events.saved).toHaveBeenCalledWith(1);
    expect(events.state.mock.calls).toEqual([["unsaved"], ["saved"]]);
  });

  it("keeps changes in order, one batch at a time", async () => {
    sync.push(remove("1"));
    sync.push({ op: "updateStar", id: "a", name: "x" });
    sync.push(remove("2"));
    sync.push({ op: "updateStar", id: "a", name: "y" });
    sync.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent[0]!.ops).toEqual([
      remove("1"),
      { op: "updateStar", id: "a", name: "x" },
      remove("2"),
      { op: "updateStar", id: "a", name: "y" },
    ]);
  });

  it("sends a change made during a request right after it", async () => {
    sync.push(remove("1"));
    sync.flush();
    sync.push(remove("2"));
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.map((b) => b.ops)).toEqual([[remove("1")], [remove("2")]]);
  });

  it("sends the same batch again when the server can't be reached", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("offline"));
    sync.push(remove("1"));
    sync.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.idle).toBe(false);
    answers.push(() => respond(503, { error: "Heimdall is away" }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.batch).toBe(sent[0]!.batch);
    expect(sync.idle).toBe(true);
    expect(events.state).toHaveBeenLastCalledWith("saved");
  });

  it("drops what is waiting when the server refuses a change, and says so", async () => {
    answers.push(() => respond(404, { error: "No such star", code: "not-found" }));
    sync.push(remove("1"));
    sync.flush();
    sync.push(remove("2"));
    await vi.advanceTimersByTimeAsync(0);
    expect(events.refused).toHaveBeenCalledWith("No such star");
    expect(sync.idle).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).toHaveLength(1);
  });

  it("waits while signed out, and carries on with the same batch afterwards", async () => {
    answers.push(() => respond(401, { error: "Not signed in", loginUrl: "https://heimdall.example.com/" }));
    sync.push(remove("1"));
    sync.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(events.signedOut).toHaveBeenCalledOnce();
    expect(events.state).toHaveBeenLastCalledWith("signed-out");
    sync.push(remove("2"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toHaveLength(1);

    sync.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.map((b) => b.ops)).toEqual([[remove("1")], [remove("1")], [remove("2")]]);
    expect(sent[1]!.batch).toBe(sent[0]!.batch);
    expect(sync.idle).toBe(true);
  });
});
