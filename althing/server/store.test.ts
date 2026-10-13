import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { AVATARS } from "../shared/avatars.ts";
import { LIMITS, LOBBY_KEY, roomKey, type Message } from "../shared/protocol.ts";
import { openDatabase } from "./db.ts";
import { StoreError, createStore, type Store } from "./store.ts";

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
let store: Store;
let clock: number;

beforeEach(() => {
  db = openDatabase(":memory:");
  clock = Date.parse("2026-10-13T12:00:00Z");
  store = createStore(db, { now: () => new Date((clock += 1000)) });
  for (const u of ["odin", "freya", "john"]) store.ensureProfile(u);
});

const profileOf = (u: string) => ({ ...store.profile(u)! });

describe("profiles", () => {
  it("start with the username as nickname and a picture from the set", () => {
    const p = profileOf("odin");
    expect(p.nickname).toBe("odin");
    expect(AVATARS).toContain(p.avatar);
    expect(store.ensureProfile("odin").created).toBe(false);
    expect(store.welcomed("odin")).toBe(false);
    store.setWelcomed("odin");
    expect(store.welcomed("odin")).toBe(true);
  });

  it("don't take a nickname someone already has", () => {
    store.updateProfile("freya", { nickname: "Loki", about: "", avatar: AVATARS[0] });
    store.ensureProfile("loki");
    expect(profileOf("loki").nickname).toBe("loki2");
  });

  it("keep nicknames unique, ignoring case", () => {
    const err = refusal(() => store.updateProfile("freya", { nickname: "ODIN", about: "", avatar: AVATARS[0] }));
    expect(err.status).toBe(409);
    expect(
      refusal(() => store.updateProfile("freya", { nickname: "Deleted User", about: "", avatar: AVATARS[0] })).status,
    ).toBe(409);
  });

  it("check nickname, about-me and picture", () => {
    const ok = { nickname: "Valkyrie", about: "", avatar: AVATARS[1] };
    expect(refusal(() => store.updateProfile("freya", { ...ok, nickname: "x" })).status).toBe(400);
    expect(refusal(() => store.updateProfile("freya", { ...ok, nickname: "x".repeat(25) })).status).toBe(400);
    expect(refusal(() => store.updateProfile("freya", { ...ok, about: "x".repeat(501) })).status).toBe(400);
    expect(refusal(() => store.updateProfile("freya", { ...ok, avatar: "../secret.png" })).status).toBe(400);
    const p = store.updateProfile("freya", { ...ok, nickname: "  Shield\n  maiden ", about: " Hi\r\nthere " });
    expect({ ...p }).toEqual({ username: "freya", nickname: "Shield maiden", about: "Hi\nthere", avatar: AVATARS[1] });
  });

  it("keep every nickname a user has had", () => {
    store.updateProfile("odin", { nickname: "Wanderer", about: "", avatar: AVATARS[0] });
    store.updateProfile("odin", { nickname: "Wanderer", about: "changed only this", avatar: AVATARS[0] });
    store.updateProfile("odin", { nickname: "Grimnir", about: "", avatar: AVATARS[0] });
    const rows = db.prepare("SELECT nickname FROM nicknames WHERE username = 'odin' ORDER BY from_at").all();
    expect(rows.map((r) => r.nickname)).toEqual(["odin", "Wanderer", "Grimnir"]);
  });

  it("get a new picture when theirs left the set", () => {
    db.prepare("UPDATE profiles SET avatar = 'gone.webp' WHERE username = 'john'").run();
    expect(store.fixAvatars()).toBe(1);
    expect(AVATARS).toContain(profileOf("john").avatar);
  });
});

describe("rooms", () => {
  it("start with the lobby, which nobody joins or closes", () => {
    expect(store.rooms().map((r) => r.name)).toEqual(["Lobby"]);
    expect(store.joinRoom("odin", 1)).toBe(false);
    expect(store.closeIfEmpty(1)).toBe(false);
  });

  it("are joined, left, and closed only when empty", () => {
    const id = store.createRoom("odin", { name: " Games " });
    expect(store.rooms()[1]).toEqual({ id, name: "Games", members: ["odin"] });
    expect(store.joinRoom("freya", id)).toBe(true);
    expect(store.joinRoom("freya", id)).toBe(false);
    expect(store.members(id)).toEqual(["freya", "odin"]);
    expect(store.leaveRoom("odin", id)).toBe(true);
    expect(store.closeIfEmpty(id)).toBe(false);
    expect(store.leaveAllRooms("freya")).toEqual([id]);
    expect(store.closeIfEmpty(id)).toBe(true);
    expect(store.rooms().map((r) => r.name)).toEqual(["Lobby"]);
    expect(refusal(() => store.joinRoom("john", id)).status).toBe(404);
  });

  it("keep their names unique while open; a closed name can be used again", () => {
    const first = store.createRoom("odin", { name: "games" });
    expect(refusal(() => store.createRoom("freya", { name: "GAMES" })).status).toBe(409);
    store.post("odin", roomKey(first), { body: "said in the first room" });
    store.leaveRoom("odin", first);
    store.closeIfEmpty(first);
    const second = store.createRoom("freya", { name: "games" });
    expect(second).not.toBe(first);
    expect(store.history("freya", roomKey(second))).toEqual([]);
    // The closed room is still on record.
    const closed = db.prepare("SELECT name, created_by, closed_at FROM rooms WHERE id = ?").get(first)!;
    expect(closed.created_by).toBe("odin");
    expect(closed.closed_at).not.toBeNull();
    expect(db.prepare("SELECT body FROM messages WHERE room_id = ?").all(first).length).toBe(1);
  });

  it("refuse bad names", () => {
    expect(refusal(() => store.createRoom("odin", { name: "  " })).status).toBe(400);
    expect(refusal(() => store.createRoom("odin", { name: "x".repeat(41) })).status).toBe(400);
  });

  it("are read and written only by the people in them", () => {
    const id = store.createRoom("odin", { name: "Hall" });
    expect(refusal(() => store.post("freya", roomKey(id), { body: "hi" })).status).toBe(403);
    expect(refusal(() => store.history("freya", roomKey(id))).status).toBe(403);
    store.post("odin", roomKey(id), { body: "before" });
    store.joinRoom("freya", id);
    expect(store.history("freya", roomKey(id)).map((m) => m.body)).toEqual(["before"]);
    // What was said before joining isn't unread.
    expect(store.unread("freya")[roomKey(id)]).toBeUndefined();
    expect(store.audience(roomKey(id))).toEqual(["freya", "odin"]);
    expect(store.audience(LOBBY_KEY)).toBe("everyone");
  });
});

describe("messages", () => {
  it("are cleaned and limited", () => {
    expect(refusal(() => store.post("odin", LOBBY_KEY, { body: " \n " })).status).toBe(400);
    expect(refusal(() => store.post("odin", LOBBY_KEY, { body: "x".repeat(LIMITS.messageChars + 1) })).status).toBe(
      400,
    );
    expect(refusal(() => store.post("odin", "x1", { body: "hi" })).status).toBe(404);
    const m = store.post("odin", LOBBY_KEY, { body: "  hello\r\nworld\u0007 " });
    expect(m).toMatchObject({ conv: LOBBY_KEY, author: "odin", body: "hello\nworld" });
  });

  it("come in pages, oldest first", () => {
    const ids: number[] = [];
    for (let i = 0; i < 120; i++) ids.push(store.post("odin", LOBBY_KEY, { body: `m${i}` }).id);
    const latest = store.history("freya", LOBBY_KEY);
    expect(latest.map((m) => m.body)).toEqual(Array.from({ length: 50 }, (_, i) => `m${i + 70}`));
    const older = store.history("freya", LOBBY_KEY, latest[0]!.id);
    expect(older.at(-1)!.body).toBe("m69");
    expect(store.history("freya", LOBBY_KEY, ids[0]!)).toEqual([]);
  });

  it("can't be changed or deleted, even directly in the database", () => {
    const m = store.post("odin", LOBBY_KEY, { body: "on record" });
    store.createRoom("odin", { name: "Hall" });
    expect(() => db.prepare("DELETE FROM messages WHERE id = ?").run(m.id)).toThrow(/on record/);
    expect(() => db.prepare("UPDATE messages SET body = 'nice' WHERE id = ?").run(m.id)).toThrow(/on record/);
    expect(() => db.prepare("UPDATE messages SET author = 'freya' WHERE id = ?").run(m.id)).toThrow(/on record/);
    expect(() => db.prepare("DELETE FROM rooms").run()).toThrow(/on record/);
    expect(() => db.prepare("DELETE FROM room_visits").run()).toThrow(/on record/);
  });

  it("count as unread for the others until they read them", () => {
    const m = store.post("odin", LOBBY_KEY, { body: "one" });
    store.post("odin", LOBBY_KEY, { body: "two" });
    expect(store.unread("odin")).toEqual({});
    expect(store.unread("freya")).toEqual({ [LOBBY_KEY]: 2 });
    store.markRead("freya", LOBBY_KEY, m.id);
    expect(store.unread("freya")).toEqual({ [LOBBY_KEY]: 1 });
    // Going back never makes messages unread again.
    store.markRead("freya", LOBBY_KEY, 0);
    expect(store.unread("freya")).toEqual({ [LOBBY_KEY]: 1 });
  });

  it("in the lobby's past aren't unread for someone new", () => {
    store.post("odin", LOBBY_KEY, { body: "old news" });
    store.ensureProfile("newcomer");
    expect(store.unread("newcomer")).toEqual({});
  });
});

describe("direct conversations", () => {
  it("are one per pair, whoever starts", () => {
    const a = store.openDm("odin", "freya");
    const b = store.openDm("freya", "odin");
    expect(a.id).toBe(b.id);
    expect(a.with).toBe("freya");
    expect(b.with).toBe("odin");
    expect(refusal(() => store.openDm("odin", "odin")).status).toBe(400);
    expect(refusal(() => store.openDm("odin", "nobody")).status).toBe(404);
  });

  it("are private to the two people", () => {
    const dm = store.openDm("odin", "freya");
    const key = `d${dm.id}`;
    store.post("odin", key, { body: "psst" });
    expect(store.history("freya", key).map((m) => m.body)).toEqual(["psst"]);
    expect(refusal(() => store.history("john", key)).status).toBe(404);
    expect(refusal(() => store.post("john", key, { body: "hi" })).status).toBe(404);
    expect(store.audience(key)).toEqual(["freya", "odin"]);
    expect(store.unread("freya")).toEqual({ [key]: 1 });
  });

  it("are listed newest first", () => {
    const withFreya = store.openDm("odin", "freya");
    const withJohn = store.openDm("odin", "john");
    store.post("odin", `d${withJohn.id}`, { body: "1" });
    store.post("odin", `d${withFreya.id}`, { body: "2" });
    expect(store.dms("odin").map((d) => d.with)).toEqual(["freya", "john"]);
    expect(store.dms("john").map((d) => d.with)).toEqual(["odin"]);
  });
});

describe("removed users", () => {
  it("are forgotten, but what they said stays", () => {
    const room = store.createRoom("john", { name: "John's room" });
    store.joinRoom("odin", room);
    store.post("john", roomKey(room), { body: "insult" });
    store.post("john", LOBBY_KEY, { body: "lobby insult" });
    const dm = store.openDm("john", "freya");
    store.post("john", `d${dm.id}`, { body: "private insult" });
    store.updateProfile("john", { nickname: "Troll", about: "", avatar: AVATARS[0] });

    const removed = store.removeUnknownOwners(new Set(["odin", "freya"]));
    expect(removed).toEqual([{ username: "john", messages: 3 }]);

    expect(store.profile("john")).toBeNull();
    const john = (sql: string) => db.prepare(sql).all().length;
    expect(john("SELECT 1 FROM nicknames WHERE username = 'john'")).toBe(0);
    expect(john("SELECT 1 FROM messages WHERE author = 'john'")).toBe(0);
    expect(john("SELECT 1 FROM room_visits WHERE username = 'john'")).toBe(0);
    expect(john("SELECT 1 FROM room_visits WHERE username IS NULL AND left_at IS NOT NULL")).toBe(1);
    expect(john("SELECT 1 FROM rooms WHERE created_by = 'john'")).toBe(0);

    const inRoom = store.history("odin", roomKey(room));
    expect(inRoom.map((m: Message) => [m.author, m.body])).toEqual([[null, "insult"]]);
    expect(store.history("freya", LOBBY_KEY).map((m) => [m.author, m.body])).toEqual([[null, "lobby insult"]]);
    expect(store.dms("freya")).toEqual([{ id: dm.id, with: null, lastId: expect.any(Number) }]);
    expect(store.history("freya", `d${dm.id}`).map((m) => m.body)).toEqual(["private insult"]);
    expect(refusal(() => store.post("freya", `d${dm.id}`, { body: "hello?" })).status).toBe(403);
    expect(store.members(room)).toEqual(["odin"]);

    // Nothing more to do the next time.
    expect(store.removeUnknownOwners(new Set(["odin", "freya"]))).toEqual([]);
  });
});
