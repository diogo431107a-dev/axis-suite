import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Op } from "../../shared/protocol.ts";
import { Store, newNode } from "./store.ts";
import { Sync, enqueue, guardedParts, takeBatch } from "./sync.ts";

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

// The page against a server whose answers the test hands out one at a time, in the order it
// chooses: an answer can arrive after a request made later.

interface Pending {
  url: string;
  answer(body: unknown): void;
}

let pending: Pending[] = [];

function fakeFetch(url: string): Promise<Response> {
  return new Promise((resolve) => {
    const answer = (body: unknown) =>
      resolve({ status: 200, ok: true, json: async () => body, text: async () => JSON.stringify(body) } as Response);
    pending.push({ url, answer });
  });
}

/** The request for url, which must have been made and not answered yet. */
function request(url: string): Pending {
  const i = pending.findIndex((p) => p.url === url);
  expect(i, `${url} among ${pending.map((p) => p.url).join(", ")}`).toBeGreaterThanOrEqual(0);
  return pending.splice(i, 1)[0]!;
}

/** Lets what the answers set off run to its end: promise steps only, as no answer waits on I/O. */
async function settle() {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

class FakeEventSource {
  static readonly CLOSED = 2;
  static latest: FakeEventSource | null = null;
  readyState = 1;
  readonly #listeners = new Map<string, ((e: { data: string }) => void)[]>();

  constructor() {
    FakeEventSource.latest = this;
  }

  addEventListener(type: string, listener: (e: { data: string }) => void): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }

  close(): void {}

  emit(type: string): void {
    for (const listener of this.#listeners.get(type) ?? []) listener({ data: "null" });
  }
}

describe("Sync", () => {
  const X = "00000000-0000-4000-8000-000000000001";
  const NO_SHARES = { byMe: [], withMe: [] };
  const row = (content: string) => ({ ...newNode(X, null, "a0"), content });

  beforeEach(() => {
    pending = [];
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.stubGlobal("fetch", fakeFetch);
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** A page showing one empty bullet, X, at revision 1. */
  async function open() {
    const store = new Store();
    const sync = new Sync(store, "odin", { notice: () => {}, reloaded: () => {} });
    const started = sync.start();
    request("/api/tree").answer({ rev: 1, nodes: [row("")], shares: NO_SHARES });
    await started;
    /** Typing that leaves X's text as `content`, then the pause after which it is sent. */
    const type = (content: string) => {
      const op: Op = { op: "update", id: X, content };
      store.applyAll([op]);
      sync.push([op]);
      vi.advanceTimersByTime(300);
    };
    return { store, type, events: FakeEventSource.latest! };
  }

  it("keeps saved text that an answer asked for earlier doesn't have yet", async () => {
    const { store, type, events } = await open();
    type("hello ");
    // The event stream reconnects while that is being saved: the page asks what it missed.
    events.emit("open");
    const changes = request("/api/changes?since=1");
    request("/api/ops").answer({ rev: 2, rejected: [] });
    await settle();
    // More is typed, and saved, before the answer arrives with the text as the first save left it.
    type("hello world");
    request("/api/ops").answer({ rev: 3, rejected: [] });
    await settle();
    changes.answer({ rev: 2, nodes: [row("hello ")], shares: NO_SHARES });
    await settle();
    expect(store.get(X)!.content).toBe("hello world");
  });

  it("keeps saved text that a reloaded tree doesn't have yet", async () => {
    const { store, type, events } = await open();
    type("hello ");
    events.emit("open");
    // What the user may see changed (a share, say): the page loads the whole tree again.
    request("/api/changes?since=1").answer({ reset: true });
    await settle();
    const tree = request("/api/tree");
    request("/api/ops").answer({ rev: 2, rejected: [] });
    await settle();
    type("hello world");
    request("/api/ops").answer({ rev: 3, rejected: [] });
    await settle();
    tree.answer({ rev: 2, nodes: [row("hello ")], shares: NO_SHARES });
    await settle();
    expect(store.get(X)!.content).toBe("hello world");
  });
});
