import { SignedOutError } from "@axis-suite/heimdall-client/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mood, Page, PageSaved, PageWrite } from "../../shared/protocol.ts";
import { ApiFailure } from "../api.ts";
import { MAX_WAIT_MS, PageSync, pageKey, type PageApi } from "./sync.ts";

const J = "journal-1";
const DAY = "2026-10-12";
const KEY = pageKey(J, DAY);

/** The server's rules for pages, in memory (see server/store.ts), with ways to make it misbehave. */
class FakeServer implements PageApi {
  pages = new Map<string, { text: string; mood: Mood | null; rev: number }>();
  rev = 100;
  puts: PageWrite[] = [];
  /** answer nothing (status 0) */
  down = false;
  signedOut = false;
  /** apply the next save, then lose the answer on the way back */
  loseNextAnswer = false;
  /** hold saves until release() */
  hold = false;
  private held: (() => void)[] = [];

  /** Someone else (another tab) saves a page. */
  write(key: string, text: string, mood: Mood | null = null) {
    this.pages.set(key, { text, mood, rev: ++this.rev });
  }

  release() {
    const held = this.held;
    this.held = [];
    for (const go of held) go();
  }

  async get(journalId: string, date: string): Promise<Page> {
    this.check();
    const p = this.pages.get(pageKey(journalId, date));
    return {
      journalId,
      date,
      text: p?.text ?? "",
      mood: p?.mood ?? null,
      tags: [],
      words: 0,
      rev: p?.rev ?? 0,
      updatedAt: null,
    };
  }

  async put(journalId: string, date: string, body: PageWrite): Promise<PageSaved> {
    this.puts.push(body);
    if (this.hold) await new Promise<void>((resolve) => this.held.push(resolve));
    this.check();
    const key = pageKey(journalId, date);
    const p = this.pages.get(key);
    const empty = body.text.trim() === "" && body.mood === null;
    let saved: PageSaved;
    if (p ? p.text === body.text && p.mood === body.mood : empty) {
      saved = { rev: p?.rev ?? 0, words: 0, tags: [], updatedAt: null };
    } else if (body.rev !== (p?.rev ?? 0)) {
      throw new ApiFailure(409, "changed", {
        error: "changed",
        code: "conflict",
        page: await this.get(journalId, date),
      });
    } else if (empty) {
      this.pages.delete(key);
      saved = { rev: 0, words: 0, tags: [], updatedAt: null };
    } else {
      this.write(key, body.text, body.mood);
      saved = { rev: this.rev, words: 0, tags: [], updatedAt: "now" };
    }
    if (this.loseNextAnswer) {
      this.loseNextAnswer = false;
      throw new ApiFailure(0, "unreachable");
    }
    return saved;
  }

  text = (key = KEY) => this.pages.get(key)?.text;

  private check() {
    if (this.signedOut) throw new SignedOutError("http://127.0.0.1:3000/");
    if (this.down) throw new ApiFailure(0, "unreachable");
  }
}

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

const DRAFT_KEY = `papyrus.draft.alice.${KEY}`;

let server: FakeServer;
let storage: Storage;
let sync: PageSync;

const settle = () => vi.advanceTimersByTimeAsync(0);
const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);

async function openDay() {
  sync.open(J, DAY);
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers();
  server = new FakeServer();
  storage = memoryStorage();
  sync = new PageSync({ api: server, user: "alice", storage, channel: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("saving", () => {
  it("loads a day, then saves it 1 s after typing stops", async () => {
    server.write(KEY, "Hello");
    await openDay();
    expect(sync.day(KEY)).toMatchObject({ loaded: true, text: "Hello", dirty: false });
    sync.edit(KEY, { text: "Hello there" });
    expect(sync.status()).toEqual({ kind: "saving" });
    await wait(900);
    expect(server.puts).toHaveLength(0);
    await wait(200);
    expect(server.text()).toBe("Hello there");
    expect(sync.day(KEY)).toMatchObject({ dirty: false, saving: false });
    expect(sync.status()).toEqual({ kind: "saved" });
    expect(storage.length).toBe(0);
  });

  it("saves at least every 10 s while typing goes on", async () => {
    await openDay();
    for (let i = 1; i * 500 <= MAX_WAIT_MS; i++) {
      sync.edit(KEY, { text: "x".repeat(i) });
      await wait(500);
    }
    expect(server.puts).toHaveLength(1);
  });

  it("saves a mood at once", async () => {
    await openDay();
    sync.edit(KEY, { mood: 4 });
    await settle();
    expect(server.pages.get(KEY)).toMatchObject({ text: "", mood: 4 });
  });

  it("saves again what was typed while a save was on its way", async () => {
    await openDay();
    server.hold = true;
    sync.edit(KEY, { text: "a" });
    await wait(1000);
    expect(sync.day(KEY)?.saving).toBe(true);
    sync.edit(KEY, { text: "ab" });
    // The pause after "ab" ends while the first save is still on its way.
    await wait(1500);
    server.hold = false;
    server.release();
    await settle();
    expect(server.text()).toBe("a");
    expect(sync.day(KEY)?.dirty).toBe(true);
    await wait(1000);
    expect(server.text()).toBe("ab");
    expect(server.puts.map((p) => p.rev)).toEqual([0, server.rev - 1]);
  });

  it("finishes the save of a day that was left, then forgets it", async () => {
    await openDay();
    server.hold = true;
    sync.edit(KEY, { text: "left behind" });
    sync.close(KEY);
    await settle();
    expect(server.puts).toHaveLength(1);
    server.release();
    await settle();
    expect(server.text()).toBe("left behind");
    expect(sync.day(KEY)).toBeUndefined();
  });

  it("keeps a draft in storage until the server has the text", async () => {
    await openDay();
    server.hold = true;
    sync.edit(KEY, { text: "precious" });
    await wait(300);
    expect(JSON.parse(storage.getItem(DRAFT_KEY)!)).toMatchObject({ text: "precious", baseRev: 0 });
    await wait(700);
    server.release();
    await settle();
    expect(storage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("deletes a page that is emptied, and writes it again from nothing", async () => {
    server.write(KEY, "x");
    await openDay();
    sync.edit(KEY, { text: "" });
    await wait(1000);
    expect(server.pages.has(KEY)).toBe(false);
    sync.edit(KEY, { text: "again" });
    await wait(1000);
    expect(server.puts.at(-1)?.rev).toBe(0);
    expect(server.text()).toBe("again");
  });
});

describe("conflicts", () => {
  async function conflict() {
    server.write(KEY, "base", 3);
    await openDay();
    sync.edit(KEY, { text: "mine" });
    server.write(KEY, "theirs", 2);
    await wait(1000);
  }

  it("stops and shows the other version", async () => {
    await conflict();
    expect(sync.day(KEY)).toMatchObject({ text: "mine", theirs: { text: "theirs", mood: 2 } });
    expect(sync.status()).toEqual({ kind: "conflict", journalId: J, date: DAY });
    sync.edit(KEY, { text: "mine, more" });
    await wait(15_000);
    expect(server.puts).toHaveLength(1);
    expect(storage.getItem(DRAFT_KEY)).toContain("mine, more");
  });

  it.each([
    ["mine", "mine", 3],
    ["theirs", "theirs", 2],
    ["both", "theirs\n\nmine", 3],
  ] as const)("keeps %s", async (choice, text, mood) => {
    await conflict();
    sync.resolve(KEY, choice);
    await settle();
    expect(server.pages.get(KEY)).toMatchObject({ text, mood: choice === "both" ? 3 : mood });
    expect(sync.day(KEY)).toMatchObject({ text, dirty: false, theirs: null });
    expect(sync.status()).toEqual({ kind: "saved" });
    expect(storage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("needs no choice when both wrote the same", async () => {
    await openDay();
    sync.edit(KEY, { text: "same" });
    server.write(KEY, "same");
    await wait(1000);
    expect(sync.day(KEY)).toMatchObject({ dirty: false, theirs: null });
  });
});

describe("failures", () => {
  it("sends again a save whose answer was lost", async () => {
    await openDay();
    server.loseNextAnswer = true;
    sync.edit(KEY, { text: "once" });
    await wait(1000);
    expect(sync.status()).toEqual({ kind: "offline" });
    await wait(1000);
    expect(sync.status()).toEqual({ kind: "saved" });
    expect(server.text()).toBe("once");
  });

  it("backs off while offline, and tries at once when the browser is online again", async () => {
    await openDay();
    const detach = sync.attach();
    server.down = true;
    sync.edit(KEY, { text: "later" });
    await wait(1000); // first try
    await wait(1000); // after 1 s
    await wait(2000); // after 2 s more
    await wait(3999); // not yet: 4 s more
    expect(server.puts).toHaveLength(3);
    expect(sync.status()).toEqual({ kind: "offline" });
    server.down = false;
    window.dispatchEvent(new Event("online"));
    await settle();
    expect(server.text()).toBe("later");
    detach();
  });

  it("waits while signed out, and carries on after signing in again", async () => {
    await openDay();
    const onSignedOut = vi.fn();
    sync.onSignedOut = onSignedOut;
    server.signedOut = true;
    sync.edit(KEY, { text: "kept" });
    await wait(1000);
    sync.edit(KEY, { text: "kept, and more" });
    await wait(20_000);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(server.puts).toHaveLength(1);
    expect(sync.status()).toEqual({ kind: "signed-out" });
    expect(storage.getItem(DRAFT_KEY)).toContain("kept, and more");
    server.signedOut = false;
    sync.resume();
    await settle();
    expect(server.text()).toBe("kept, and more");
  });

  it("keeps the text of a page the server refuses, and says why", async () => {
    await openDay();
    server.put = async () => {
      throw new ApiFailure(404, "No such journal", { error: "No such journal", code: "not-found" });
    };
    sync.edit(KEY, { text: "nowhere to go" });
    await wait(1000);
    expect(sync.day(KEY)).toMatchObject({ problem: "No such journal", dirty: true });
    expect(sync.status()).toEqual({ kind: "problem", journalId: J, date: DAY });
    expect(storage.getItem(DRAFT_KEY)).toContain("nowhere to go");
  });
});

describe("drafts from an earlier visit", () => {
  const leaveDraft = (text: string, baseRev: number) =>
    storage.setItem(DRAFT_KEY, JSON.stringify({ text, mood: null, baseRev, at: 0 }));

  it("drops a draft the server already has", async () => {
    server.write(KEY, "saved");
    leaveDraft("saved", 1);
    await openDay();
    expect(storage.getItem(DRAFT_KEY)).toBeNull();
    expect(sync.day(KEY)?.dirty).toBe(false);
  });

  it("sends a draft written on the version that is still there", async () => {
    server.write(KEY, "old");
    leaveDraft("old, and new", server.rev);
    await openDay();
    await settle();
    expect(server.text()).toBe("old, and new");
  });

  it("asks about a draft written on an older version", async () => {
    server.write(KEY, "changed since");
    leaveDraft("unsent", server.rev - 1);
    await openDay();
    expect(sync.day(KEY)).toMatchObject({ text: "unsent", theirs: { text: "changed since" } });
    expect(server.puts).toHaveLength(0);
  });

  it("sends the drafts of days that aren't open, then forgets them", async () => {
    leaveDraft("from yesterday's visit", 0);
    sync.adoptDrafts();
    await settle();
    await settle();
    expect(server.text()).toBe("from yesterday's visit");
    expect(sync.day(KEY)).toBeUndefined();
    expect(storage.length).toBe(0);
  });
});

describe("other tabs", () => {
  it("fetches a day again when it has no changes here", async () => {
    server.write(KEY, "first");
    await openDay();
    server.write(KEY, "from another tab");
    sync.refresh(KEY);
    await settle();
    expect(sync.day(KEY)).toMatchObject({ text: "from another tab", dirty: false });
  });

  it("doesn't touch a day with changes here", async () => {
    server.write(KEY, "first");
    await openDay();
    sync.edit(KEY, { text: "typing" });
    server.write(KEY, "from another tab");
    sync.refresh(KEY);
    await settle();
    expect(sync.day(KEY)?.text).toBe("typing");
  });
});
