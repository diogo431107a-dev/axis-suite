import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../shared/protocol.ts";
import { createCompanions } from "./companions.ts";
import { openDatabase, removeUnknownOwners, transaction } from "./db.ts";

describe("a transaction", () => {
  it("keeps all of its work, or none of it", () => {
    const db = openDatabase(":memory:");
    const companions = createCompanions(db, "odin", DEFAULT_SETTINGS);
    expect(() =>
      transaction(db, () => {
        companions.save("comp-0001", { name: "Hrothgar" });
        throw new Error("halfway");
      }),
    ).toThrow("halfway");
    expect(companions.list()).toEqual([]);
  });

  it("can hold another one, which rolls back on its own", () => {
    const db = openDatabase(":memory:");
    const companions = createCompanions(db, "odin", DEFAULT_SETTINGS);
    transaction(db, () => {
      companions.save("comp-0001", { name: "Hrothgar" });
      try {
        transaction(db, () => {
          companions.save("comp-0002", { name: "Wealhtheow" });
          throw new Error("inner");
        });
      } catch {
        // The inner step is undone; the outer one carries on.
      }
    });
    expect(companions.list().map((companion) => companion.name)).toEqual(["Hrothgar"]);
  });
});

describe("people removed from Heimdall", () => {
  it("leave nothing behind, and nobody else loses anything", () => {
    const db = openDatabase(":memory:");
    createCompanions(db, "odin", DEFAULT_SETTINGS).save("comp-0001", { name: "Hrothgar" });
    createCompanions(db, "loki", DEFAULT_SETTINGS).save("comp-0002", { name: "Grendel" });
    expect(removeUnknownOwners(db, new Set(["odin"]))).toEqual(["loki"]);
    expect(createCompanions(db, "loki", DEFAULT_SETTINGS).list()).toEqual([]);
    expect(createCompanions(db, "odin", DEFAULT_SETTINGS).list()).toHaveLength(1);
  });
});

describe("a companion", () => {
  it("keeps its profile as written and only the prompt texts it changed", () => {
    const companions = createCompanions(openDatabase(":memory:"), "odin", DEFAULT_SETTINGS);
    const saved = companions.save("comp-0001", {
      name: "Hrothgar",
      profile: "<personality>\nProud.\n</personality>",
      prompts: { greeting: "Open gruffly.", rejection: "  " },
    });
    expect(saved.profile).toBe("<personality>\nProud.\n</personality>");
    expect(saved.prompts).toEqual({ greeting: "Open gruffly." });
    expect(saved.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("takes its chats with it when deleted", () => {
    const db = openDatabase(":memory:");
    const companions = createCompanions(db, "odin", DEFAULT_SETTINGS);
    companions.save("comp-0001", { name: "Hrothgar" });
    db.prepare(
      "INSERT INTO chats (id, companion_id, title, created_at, last_activity_at) VALUES ('chat-0001', 'comp-0001', 't', '', '')",
    ).run();
    companions.remove("comp-0001");
    expect(db.prepare("SELECT count(*) AS n FROM chats").get()).toEqual({ n: 0 });
  });
});
