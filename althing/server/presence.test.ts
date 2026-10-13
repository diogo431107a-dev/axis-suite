import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "./db.ts";
import { GRACE_MS, createPresence } from "./presence.ts";
import { createStore, type Store } from "./store.ts";

let store: Store;
let connected: Set<string>;
let changes: number;

function presence() {
  return createPresence(store, { isConnected: (u) => connected.has(u), onRoomsChanged: () => changes++ });
}

beforeEach(() => {
  vi.useFakeTimers();
  store = createStore(openDatabase(":memory:"));
  for (const u of ["odin", "freya"]) store.ensureProfile(u);
  connected = new Set(["odin", "freya"]);
  changes = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

const roomNames = () => store.rooms().map((r) => r.name);

describe("rooms", () => {
  it("close a grace period after the last person leaves, and stay on record", () => {
    const p = presence();
    const id = p.create("odin", { name: "Games" });
    p.leave("odin", id);
    expect(roomNames()).toEqual(["Lobby", "Games"]);
    vi.advanceTimersByTime(GRACE_MS);
    expect(roomNames()).toEqual(["Lobby"]);
    expect(changes).toBe(3);
  });

  it("stay open if someone joins during the grace period", () => {
    const p = presence();
    const id = p.create("odin", { name: "Games" });
    p.leave("odin", id);
    vi.advanceTimersByTime(GRACE_MS / 2);
    p.join("freya", id);
    vi.advanceTimersByTime(GRACE_MS);
    expect(store.rooms().find((r) => r.id === id)?.members).toEqual(["freya"]);
  });

  it("keep people who come back within the grace period (a reload)", () => {
    const p = presence();
    const id = p.create("odin", { name: "Games" });
    connected.delete("odin");
    p.disconnected("odin");
    vi.advanceTimersByTime(GRACE_MS / 2);
    connected.add("odin");
    p.connected("odin");
    vi.advanceTimersByTime(GRACE_MS * 2);
    expect(store.members(id)).toEqual(["odin"]);
  });

  it("lose people who closed Althing, then close", () => {
    const p = presence();
    const id = p.create("odin", { name: "Games" });
    connected.delete("odin");
    p.disconnected("odin");
    vi.advanceTimersByTime(GRACE_MS);
    expect(store.members(id)).toEqual([]);
    expect(roomNames()).toEqual(["Lobby", "Games"]);
    vi.advanceTimersByTime(GRACE_MS);
    expect(roomNames()).toEqual(["Lobby"]);
  });

  it("survive a restart if their people reconnect in time", () => {
    const first = presence();
    const kept = first.create("odin", { name: "Kept" });
    const lost = first.create("freya", { name: "Lost" });
    first.stop();

    // The server restarts: nobody is connected yet.
    connected.clear();
    const second = presence();
    second.start();
    vi.advanceTimersByTime(GRACE_MS / 2);
    connected.add("odin");
    second.connected("odin");
    vi.advanceTimersByTime(GRACE_MS * 3);
    expect(store.members(kept)).toEqual(["odin"]);
    expect(store.rooms().some((r) => r.id === lost)).toBe(false);
  });

  it("never include the lobby", () => {
    const p = presence();
    p.start();
    vi.advanceTimersByTime(GRACE_MS * 3);
    expect(roomNames()).toEqual(["Lobby"]);
  });
});
