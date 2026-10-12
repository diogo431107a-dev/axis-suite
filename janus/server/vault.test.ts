import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { EntrySummary, ExportFile } from "../shared/protocol.ts";
import { openDatabase } from "./db.ts";
import { parseKey } from "./keys.ts";
import { OpenError, createSealer } from "./seal.ts";
import { KeyMismatchError, VaultError, createVault, type VaultStore } from "./vault.ts";

const SECRET = "JBSWY3DPEHPK3PXP";

/** The VaultError a call throws (fails the test if it doesn't throw one). */
function refusal(fn: () => unknown): VaultError {
  try {
    fn();
  } catch (err) {
    if (err instanceof VaultError) return err;
    throw err;
  }
  throw new Error("expected a VaultError");
}

describe("keys", () => {
  it("reads 32 bytes of base64", () => {
    const encoded = randomBytes(32).toString("base64");
    expect(parseKey(`${encoded}\n`, "k").toString("base64")).toBe(encoded);
  });
  it.each([
    ["too short", randomBytes(16).toString("base64")],
    ["not base64", "x".repeat(43) + "!"],
    ["empty", ""],
  ])("refuses a key that is %s", (_why, text) => {
    expect(() => parseKey(text, "k")).toThrow(/32 random bytes/);
  });
});

describe("seal", () => {
  const sealer = createSealer(randomBytes(32));

  it("round-trips a value", () => {
    const value = { a: "pässwörd", n: [1, 2] };
    expect(sealer.open(sealer.seal(value, "ctx"), "ctx")).toEqual(value);
  });
  it("hides the plain text", () => {
    expect(Buffer.from(sealer.seal("hunter2-hunter2", "ctx")).includes("hunter2")).toBe(false);
  });
  it("uses a new IV every time", () => {
    expect(Buffer.from(sealer.seal("x", "ctx"))).not.toEqual(Buffer.from(sealer.seal("x", "ctx")));
  });
  it("refuses another context", () => {
    expect(() => sealer.open(sealer.seal("x", "entries.data:alice:1"), "entries.data:bob:1")).toThrow(OpenError);
  });
  it("refuses another key", () => {
    expect(() => createSealer(randomBytes(32)).open(sealer.seal("x", "ctx"), "ctx")).toThrow(OpenError);
  });
  it("refuses a changed byte", () => {
    const blob = sealer.seal("some value", "ctx");
    for (const at of [0, 5, blob.length - 20, blob.length - 1]) {
      const changed = Uint8Array.from(blob);
      changed[at]! ^= 1;
      expect(() => sealer.open(changed, "ctx")).toThrow(OpenError);
    }
  });
});

describe("vault", () => {
  let db: DatabaseSync;
  let key: Buffer;
  let vault: VaultStore;

  beforeEach(() => {
    db = openDatabase(":memory:");
    key = randomBytes(32);
    vault = createVault(db, createSealer(key));
  });

  const newEntry = (owner: string, fields: Record<string, unknown> = {}) =>
    vault.createEntry(owner, { groupId: null, title: "Mail", username: "me", password: "hunter2", ...fields });

  describe("the key check", () => {
    it("opens again with the same key", () => {
      expect(() => createVault(db, createSealer(key))).not.toThrow();
    });
    it("refuses another key", () => {
      expect(() => createVault(db, createSealer(randomBytes(32)))).toThrow(KeyMismatchError);
    });
  });

  describe("at rest", () => {
    it("stores nothing people typed in plain text", () => {
      const g = vault.createGroup("alice", { name: "Banking-Group", parentId: null });
      newEntry("alice", {
        groupId: g.id,
        title: "Bank-Title",
        username: "alice-user",
        password: "S3cret-Pa55",
        url: "https://bank.example",
        notes: "recovery-codes",
        totp: SECRET,
      });
      const dump = JSON.stringify(
        [...db.prepare("SELECT * FROM groups").all(), ...db.prepare("SELECT * FROM entries").all()],
        (_k, v: unknown) => (v instanceof Uint8Array ? Buffer.from(v).toString("latin1") : v),
      );
      for (const typed of [
        "Banking-Group",
        "Bank-Title",
        "alice-user",
        "S3cret-Pa55",
        "bank.example",
        "recovery",
        SECRET,
      ]) {
        expect(dump).not.toContain(typed);
      }
    });
    it("can't open a row copied to another user", () => {
      const e = newEntry("alice");
      db.prepare("UPDATE entries SET owner = 'mallory' WHERE id = ?").run(e.id);
      expect(() => vault.getEntry("mallory", e.id)).toThrow(OpenError);
    });
  });

  describe("owners", () => {
    it("sees only their own", () => {
      const g = vault.createGroup("alice", { name: "Work", parentId: null });
      const e = newEntry("alice", { groupId: g.id });
      expect(vault.load("bob")).toEqual({ groups: [], entries: [] });
      for (const fn of [
        () => vault.getEntry("bob", e.id),
        () => vault.updateEntry("bob", e.id, { title: "x" }),
        () => vault.deleteEntry("bob", e.id),
        () => vault.totpUri("bob", e.id),
        () => vault.updateGroup("bob", g.id, { name: "x" }),
        () => vault.deleteGroup("bob", g.id),
      ]) {
        expect(refusal(fn).status).toBe(404);
      }
    });
    it("can't put things in someone else's group", () => {
      const g = vault.createGroup("alice", { name: "Work", parentId: null });
      expect(refusal(() => newEntry("bob", { groupId: g.id })).status).toBe(400);
      expect(refusal(() => vault.createGroup("bob", { name: "Mine", parentId: g.id })).status).toBe(400);
    });
  });

  describe("entries", () => {
    it("lists entries without their secrets", () => {
      newEntry("alice", { notes: "private", totp: SECRET });
      const [summary] = vault.load("alice").entries;
      expect(summary).toMatchObject({ title: "Mail", username: "me", hasTotp: true, deletedAt: null });
      expect(JSON.stringify(summary)).not.toMatch(/hunter2|private|JBSW/);
    });
    it("returns the password and notes, and the TOTP without its secret", () => {
      const e = vault.getEntry("alice", newEntry("alice", { notes: "n", totp: SECRET }).id);
      expect(e).toMatchObject({ password: "hunter2", notes: "n" });
      expect(e.totp).toEqual({ issuer: "", label: "", algorithm: "SHA1", digits: 6, period: 30 });
    });
    it("changes only the fields sent, and counts revisions", () => {
      const e = newEntry("alice");
      const updated = vault.updateEntry("alice", e.id, { password: "new", rev: e.rev });
      expect(updated).toMatchObject({ title: "Mail", username: "me", password: "new", rev: e.rev + 1 });
    });
    it("refuses an edit based on an old revision", () => {
      const e = newEntry("alice");
      vault.updateEntry("alice", e.id, { title: "Elsewhere", rev: e.rev });
      const err = refusal(() => vault.updateEntry("alice", e.id, { title: "Here", rev: e.rev }));
      expect([err.status, err.code]).toEqual([409, "conflict"]);
      expect(vault.getEntry("alice", e.id).title).toBe("Elsewhere");
    });
    it("checks types and lengths", () => {
      expect(refusal(() => newEntry("alice", { title: 5 })).status).toBe(400);
      expect(refusal(() => newEntry("alice", { notes: "x".repeat(100_001) })).status).toBe(400);
      expect(refusal(() => vault.createEntry("alice", "not an object")).status).toBe(400);
    });
    it("sets, keeps and removes the TOTP", () => {
      const e = newEntry("alice");
      expect(
        vault.updateEntry("alice", e.id, { totp: `otpauth://totp/GitHub:me?secret=${SECRET}` }).totp,
      ).toMatchObject({
        issuer: "GitHub",
      });
      expect(vault.updateEntry("alice", e.id, { title: "Still" }).totp).toMatchObject({ issuer: "GitHub" });
      expect(vault.updateEntry("alice", e.id, { totp: null }).totp).toBeNull();
      expect(refusal(() => vault.updateEntry("alice", e.id, { totp: "not base32 1" })).message).toMatch(/base32/);
    });
    it("makes codes and links from the stored TOTP", async () => {
      const e = newEntry("alice", { totp: `otpauth://totp/x?secret=${SECRET}&digits=8` });
      const code = await vault.totpCode("alice", e.id, 59_000);
      expect(code).toEqual({ code: expect.stringMatching(/^\d{8}$/), period: 30, remaining: 1 });
      expect(vault.totpUri("alice", e.id)).toContain(`secret=${SECRET}`);
      const plain = newEntry("alice");
      await expect(vault.totpCode("alice", plain.id)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("recycle bin", () => {
    it("deletes to the bin, restores, and purges only from the bin", () => {
      const e = newEntry("alice");
      expect(refusal(() => vault.purgeEntry("alice", e.id)).code).toBe("not-in-bin");
      expect(vault.deleteEntry("alice", e.id).deletedAt).not.toBeNull();
      expect(vault.restoreEntry("alice", e.id).deletedAt).toBeNull();
      vault.deleteEntry("alice", e.id);
      vault.purgeEntry("alice", e.id);
      expect(vault.load("alice").entries).toEqual([]);
    });
    it("empties entries deleted more than 30 days ago", () => {
      const old = newEntry("alice", { title: "old" });
      const recent = newEntry("alice", { title: "recent" });
      vault.deleteEntry("alice", old.id);
      vault.deleteEntry("alice", recent.id);
      db.prepare("UPDATE entries SET deleted_at = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", old.id);
      expect(vault.purge()).toBe(1);
      expect(vault.load("alice").entries.map((e: EntrySummary) => e.title)).toEqual(["recent"]);
    });
  });

  describe("removeUnknownOwners", () => {
    it("deletes the whole vault of users no longer in Heimdall, and nobody else's", () => {
      const top = vault.createGroup("bob", { name: "Top", parentId: null });
      const sub = vault.createGroup("bob", { name: "Sub", parentId: top.id });
      newEntry("bob", { groupId: sub.id, title: "in sub" });
      vault.deleteEntry("bob", newEntry("bob", { groupId: top.id, title: "in bin" }).id);
      newEntry("bob", { title: "at top" });
      const mine = vault.createGroup("alice", { name: "Mine", parentId: null });
      newEntry("alice", { groupId: mine.id, title: "kept" });

      expect(vault.removeUnknownOwners(new Set(["alice"]))).toEqual([{ owner: "bob", entries: 3, groups: 2 }]);
      expect(vault.load("bob")).toEqual({ groups: [], entries: [] });
      const alice = vault.load("alice");
      expect(alice.groups.map((g) => g.name)).toEqual(["Mine"]);
      expect(alice.entries.map((e: EntrySummary) => e.title)).toEqual(["kept"]);
      expect(vault.removeUnknownOwners(new Set(["alice"]))).toEqual([]);
    });
  });

  describe("groups", () => {
    it("renames and moves, but never into itself", () => {
      const a = vault.createGroup("alice", { name: " A ", parentId: null });
      const b = vault.createGroup("alice", { name: "B", parentId: a.id });
      expect(a.name).toBe("A");
      expect(vault.updateGroup("alice", b.id, { name: "B2", parentId: null })).toMatchObject({
        name: "B2",
        parentId: null,
      });
      vault.updateGroup("alice", b.id, { parentId: a.id });
      expect(refusal(() => vault.updateGroup("alice", a.id, { parentId: b.id })).message).toMatch(/inside itself/);
      expect(refusal(() => vault.updateGroup("alice", a.id, { parentId: a.id })).message).toMatch(/inside itself/);
      expect(refusal(() => vault.updateGroup("alice", a.id, { name: "  " })).status).toBe(400);
    });
    it("deletes only empty groups, and lets go of entries in the bin", () => {
      const g = vault.createGroup("alice", { name: "G", parentId: null });
      const sub = vault.createGroup("alice", { name: "Sub", parentId: g.id });
      const e = newEntry("alice", { groupId: g.id });
      expect(refusal(() => vault.deleteGroup("alice", g.id)).code).toBe("not-empty");
      vault.deleteGroup("alice", sub.id);
      expect(refusal(() => vault.deleteGroup("alice", g.id)).code).toBe("not-empty");
      vault.deleteEntry("alice", e.id);
      vault.deleteGroup("alice", g.id);
      expect(vault.restoreEntry("alice", e.id)).toMatchObject({ groupId: null, deletedAt: null });
    });
  });

  describe("export and import", () => {
    function fill(owner: string) {
      const work = vault.createGroup(owner, { name: "Work", parentId: null });
      const servers = vault.createGroup(owner, { name: "Servers", parentId: work.id });
      vault.createGroup(owner, { name: "Empty", parentId: null });
      newEntry(owner, { groupId: servers.id, title: "db", totp: `otpauth://totp/Acme:me?secret=${SECRET}` });
      newEntry(owner, { title: "top" });
      vault.deleteEntry(owner, newEntry(owner, { title: "binned" }).id);
    }

    it("exports groups by path and entries in plain text, without the bin", () => {
      fill("alice");
      const file = vault.exportAll("alice");
      expect(file).toMatchObject({ format: "janus", version: 1 });
      expect(file.groups).toEqual(expect.arrayContaining([["Work"], ["Work", "Servers"], ["Empty"]]));
      expect(file.entries.map((e) => [e.group, e.title, e.password])).toEqual(
        expect.arrayContaining([
          [["Work", "Servers"], "db", "hunter2"],
          [[], "top", "hunter2"],
        ]),
      );
      expect(file.entries).toHaveLength(2);
      expect(file.entries.find((e) => e.title === "db")!.totp).toContain(SECRET);
    });

    it("imports into another vault, and a second time adds nothing", () => {
      fill("alice");
      const file: ExportFile = JSON.parse(JSON.stringify(vault.exportAll("alice")));
      expect(vault.importAll("bob", file)).toEqual({ groups: 3, entries: 2, skipped: 0 });
      expect(vault.importAll("bob", file)).toEqual({ groups: 0, entries: 0, skipped: 2 });
      const bob = vault.exportAll("bob");
      expect(bob.groups).toEqual(expect.arrayContaining(file.groups));
      expect(bob.entries.map(({ createdAt: _c, ...e }) => e)).toEqual(
        expect.arrayContaining(file.entries.map(({ createdAt: _c, ...e }) => e)),
      );
    });

    it("merges into groups that already exist", () => {
      vault.createGroup("bob", { name: "Work", parentId: null });
      fill("alice");
      expect(vault.importAll("bob", vault.exportAll("alice")).groups).toBe(2);
    });

    it("refuses a bad file without writing anything", () => {
      fill("alice");
      const file = vault.exportAll("alice");
      file.entries.push({ ...file.entries[0]!, totp: "otpauth://totp/x?secret=1" });
      expect(refusal(() => vault.importAll("bob", file)).message).toMatch(/^Entry 3: .*base32/);
      expect(vault.load("bob")).toEqual({ groups: [], entries: [] });
      expect(refusal(() => vault.importAll("bob", { format: "keepass" })).status).toBe(400);
    });
  });
});
