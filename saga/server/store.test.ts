import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { AccountError, SESSION_IDLE_MS, createAccounts, normalizeInvite, type Accounts } from "./accounts.ts";
import { openDatabase } from "./db.ts";
import { RANKING_SIZE, createSaves, type Saves, type Summary } from "./saves.ts";

let db: DatabaseSync;
let accounts: Accounts;
let saves: Saves;
let now: number;

/** The AccountError a call rejects with (fails the test if it doesn't). */
async function refusal(fn: () => unknown): Promise<AccountError> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof AccountError) return err;
    throw err;
  }
  throw new Error("expected an AccountError");
}

let joined = 0;
/** A new player, joined with a fresh invite. */
async function join(username: string, heroName = username) {
  const { code } = accounts.createInvite();
  now += 1000 * ++joined; // join order breaks ranking ties
  return accounts.signUp({ invite: code, username, password: "correct horse", heroName, avatar: "knight" });
}

const summary = (s: Partial<Summary> = {}): Summary => ({
  level: 1,
  fame: 0,
  front: 0,
  dragonKills: 0,
  dragonKinds: 0,
  loops: 0,
  habits: 1,
  ...s,
});

beforeEach(() => {
  db = openDatabase(":memory:");
  now = Date.parse("2026-10-25T09:00:00Z");
  accounts = createAccounts(db, () => now);
  saves = createSaves(db, () => now);
});

describe("invites", () => {
  it("reads codes however they are typed", () => {
    expect(normalizeInvite("saga-7kq2-m9xd")).toBe("SAGA-7KQ2-M9XD");
    expect(normalizeInvite(" 7KQ2 M9XD ")).toBe("SAGA-7KQ2-M9XD");
    expect(normalizeInvite("7KQ2M9")).toBe("");
  });

  it("lets one player join with a code, and only one", async () => {
    const { code } = accounts.createInvite("for Ana");
    const p = await accounts.signUp({
      invite: code.toLowerCase(),
      username: "ana",
      password: "correct horse",
      heroName: "  Ana   the Bold ",
      avatar: "sage",
    });
    expect(p).toMatchObject({ username: "ana", heroName: "Ana the Bold", avatar: "sage" });
    const again = await refusal(() =>
      accounts.signUp({ invite: code, username: "bob", password: "correct horse", heroName: "Bo", avatar: "sage" }),
    );
    expect(again.status).toBe(403);
    expect(accounts.listInvites()[0]).toMatchObject({ code, note: "for Ana", usedBy: "ana" });
  });

  it("refuses an expired code", async () => {
    const { code } = accounts.createInvite();
    now += 31 * 24 * 60 * 60_000;
    const err = await refusal(() =>
      accounts.signUp({ invite: code, username: "ana", password: "correct horse", heroName: "Ana", avatar: "sage" }),
    );
    expect(err.message).toMatch(/expired/);
  });

  it("keeps the code when the sign-up is refused", async () => {
    await join("ana", "Ana");
    const { code } = accounts.createInvite();
    const taken = await refusal(() =>
      accounts.signUp({ invite: code, username: "bob", password: "correct horse", heroName: "ANA", avatar: "sage" }),
    );
    expect(taken.status).toBe(409);
    expect(accounts.listInvites().find((i) => i.code === code)?.usedBy).toBeNull();
  });
});

describe("signing in", () => {
  it("checks the password, and ignores the username's case", async () => {
    await join("Ana");
    expect(await accounts.signIn("ana", "correct horse")).toMatchObject({ username: "Ana" });
    expect(await accounts.signIn("ana", "wrong horse")).toBeNull();
    expect(await accounts.signIn("nobody", "correct horse")).toBeNull();
  });

  it("ends a session nobody used for 30 days", async () => {
    const p = await join("ana");
    const token = accounts.createSession(p.id);
    now += SESSION_IDLE_MS - 60_000;
    expect(accounts.sessionPlayer(token)?.id).toBe(p.id);
    now += SESSION_IDLE_MS - 60_000; // it was used just now, so it lives on
    expect(accounts.sessionPlayer(token)?.id).toBe(p.id);
    now += SESSION_IDLE_MS + 60_000;
    expect(accounts.sessionPlayer(token)).toBeNull();
  });

  it("makes a player choose a new password after the owner resets it", async () => {
    const p = await join("ana");
    const token = accounts.createSession(p.id);
    const temporary = await accounts.resetPassword("ana");
    expect(accounts.sessionPlayer(token)).toBeNull(); // signed out everywhere
    const back = await accounts.signIn("ana", temporary);
    expect(back?.mustChangePassword).toBe(true);
    await accounts.changePassword(p.id, temporary, "a brand new one");
    expect((await accounts.signIn("ana", "a brand new one"))?.mustChangePassword).toBe(false);
  });
});

describe("saves", () => {
  it("refuses a save made from an older revision, and hands back the newer one", async () => {
    const p = await join("ana");
    expect(saves.save(p.id, 0, { v: 4, gold: 1 }, summary())).toEqual({ ok: true, revision: 1 });
    expect(saves.save(p.id, 1, { v: 4, gold: 2 }, summary())).toEqual({ ok: true, revision: 2 });
    // another tab, still at revision 1
    expect(saves.save(p.id, 1, { v: 4, gold: 99 }, summary())).toEqual({
      ok: false,
      current: { revision: 2, state: { v: 4, gold: 2 } },
    });
    // and a second first save
    expect(saves.save(p.id, 0, { v: 4, gold: 99 }, summary())).toMatchObject({ ok: false });
  });

  it("starts at revision 1 again after starting over", async () => {
    const p = await join("ana");
    saves.save(p.id, 0, { v: 4 }, summary());
    saves.clear(p.id);
    expect(saves.load(p.id)).toBeNull();
    expect(saves.save(p.id, 1, { v: 4 }, summary())).toEqual({ ok: true, revision: 1 });
  });

  it("goes with the account", async () => {
    const p = await join("ana");
    saves.save(p.id, 0, { v: 4 }, summary());
    await accounts.deleteAccount(p.id, "correct horse");
    expect(saves.load(p.id)).toBeNull();
    expect(saves.ranking("fame").rows).toEqual([]);
  });
});

describe("ranking", () => {
  it("sorts by fame then level, or by level then fame, and early joiners first on a tie", async () => {
    const a = await join("ana");
    const b = await join("bob");
    const c = await join("cyd");
    saves.save(a.id, 0, { v: 4 }, summary({ fame: 10, level: 3 }));
    saves.save(b.id, 0, { v: 4 }, summary({ fame: 10, level: 5 }));
    saves.save(c.id, 0, { v: 4 }, summary({ fame: 2, level: 9 }));
    expect(saves.ranking("fame").rows.map((r) => r.heroName)).toEqual(["bob", "ana", "cyd"]);
    expect(saves.ranking("level").rows.map((r) => r.heroName)).toEqual(["cyd", "bob", "ana"]);
    saves.save(a.id, 1, { v: 4 }, summary({ fame: 10, level: 5 }));
    expect(saves.ranking("fame", a.id).rows.map((r) => [r.rank, r.heroName, r.you])).toEqual([
      [1, "ana", true],
      [2, "bob", false],
      [3, "cyd", false],
    ]);
  });

  it("leaves out players without habits", async () => {
    const a = await join("ana");
    saves.save(a.id, 0, { v: 4 }, summary({ habits: 0 }));
    expect(saves.ranking("fame", a.id)).toEqual({ rows: [], you: null });
  });

  it("shows the top, and the player's own row below it", async () => {
    let last = 0;
    // Straight into the table: hashing 101 passwords would take seconds.
    const add = db.prepare(
      "INSERT INTO players (username, password_hash, hero_name, avatar, created_at) VALUES (?, '-', ?, 'knight', ?)",
    );
    for (let i = 0; i <= RANKING_SIZE; i++) {
      const id = Number(add.run(`player${i}`, `player${i}`, new Date(now + i).toISOString()).lastInsertRowid);
      saves.save(id, 0, { v: 4 }, summary({ fame: 1000 - i }));
      last = id;
    }
    const { rows, you } = saves.ranking("fame", last);
    expect(rows).toHaveLength(RANKING_SIZE);
    expect(you).toMatchObject({ rank: RANKING_SIZE + 1, heroName: `player${RANKING_SIZE}`, you: true });
  });
});
