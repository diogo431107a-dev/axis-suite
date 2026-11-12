import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConversations } from "./log.ts";
import { createStore } from "./store.ts";
import { removeUnknownOwners, rootOf } from "./users.ts";

let state: string;
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), "valhalla-users-"));
});
afterEach(() => {
  rmSync(state, { recursive: true, force: true });
});

const character = { name: "Luvia", personality: "Dry.", appearance: "", behavior: "" };

describe("each person's folder", () => {
  it("keeps one person's things out of another's sight", async () => {
    const odin = createStore(rootOf("odin", state));
    const freya = createStore(rootOf("freya", state));
    await odin.saveCharacter("char-0001", character);
    await odin.savePersona("pers-0001", { name: "A wanderer" });

    expect((await odin.characters()).map((c) => c.name)).toEqual(["Luvia"]);
    expect(await freya.characters()).toEqual([]);
    await expect(freya.character("char-0001")).rejects.toMatchObject({ status: 404 });
    expect(existsSync(join(state, "users", "odin", "characters", "char-0001.json"))).toBe(true);

    const theirs = createConversations(freya, rootOf("freya", state));
    await expect(
      theirs.create({ id: "conv-0001", characterId: "char-0001", personaId: "pers-0001" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a username that could leave the users folder", () => {
    for (const bad of ["", "..", "../odin", "odin/../freya", "a\\b", ".hidden", "x".repeat(65)]) {
      expect(() => rootOf(bad, state), bad).toThrow();
    }
    expect(rootOf("john", state)).toBe(join(state, "users", "john"));
  });
});

describe("people removed from Heimdall", () => {
  it("lose their folder; everyone else keeps theirs", async () => {
    for (const name of ["odin", "freya", "loki"]) {
      mkdirSync(join(state, "users", name, "characters"), { recursive: true });
      writeFileSync(join(state, "users", name, "characters", "c.json"), "{}");
    }
    expect(await removeUnknownOwners(new Set(["odin", "freya"]), state)).toEqual({ removed: ["loki"], failed: [] });
    expect(existsSync(join(state, "users", "loki"))).toBe(false);
    expect(existsSync(join(state, "users", "odin", "characters", "c.json"))).toBe(true);
  });

  it("is a no-op before anyone has a folder", async () => {
    expect(await removeUnknownOwners(new Set(["odin"]), state)).toEqual({ removed: [], failed: [] });
  });
});
