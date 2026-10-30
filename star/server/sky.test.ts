import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { LIMITS, type Op, type Star } from "../shared/protocol.ts";
import { openDatabase } from "./db.ts";
import { StoreError } from "./errors.ts";
import { createSky, type SkyStore } from "./sky.ts";

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

function star(id: string, parent: string | null = null, fields: Partial<Star> = {}): Star {
  return { id, name: id, memo: "", parent, relation: parent ? "brother" : "", hue: 0, x: 1, y: 2, ...fields };
}

let db: DatabaseSync;
let sky: SkyStore;

function apply(owner: string, ...ops: Op[]) {
  return sky.applyOps(owner, { batch: randomUUID(), ops });
}
const addStar = (owner: string, s: Star) => apply(owner, { op: "addStar", star: s });
const names = (owner: string) => sky.load(owner).stars.map((s) => s.id);

beforeEach(() => {
  db = openDatabase(":memory:");
  sky = createSky(db);
});

describe("stars", () => {
  it("starts empty", () => {
    expect(sky.load("odin")).toEqual({ stars: [], links: [], rev: 0 });
  });

  it("adds, edits and moves stars, in creation order", () => {
    addStar("odin", star("bob", null, { hue: 3 }));
    addStar("odin", star("mark", "bob"));
    apply("odin", { op: "updateStar", id: "mark", name: "Mark", memo: "Engineer", relation: "cousin" });
    apply("odin", { op: "moveStars", moves: [{ id: "mark", x: -5.5, y: 7 }] });
    const { stars, rev } = sky.load("odin");
    expect(rev).toBe(4);
    expect(stars.map((s) => s.id)).toEqual(["bob", "mark"]);
    expect(stars[0]!.hue).toBe(3);
    expect(stars[1]).toEqual({
      id: "mark",
      name: "Mark",
      memo: "Engineer",
      parent: "bob",
      relation: "cousin",
      hue: 0,
      x: -5.5,
      y: 7,
    });
  });

  it("leaves out what an update doesn't name, and can empty a field", () => {
    addStar("odin", star("bob", null, { memo: "Neighbor" }));
    apply("odin", { op: "updateStar", id: "bob", name: "" });
    expect(sky.load("odin").stars[0]).toMatchObject({ name: "", memo: "Neighbor" });
  });

  it("removes a star's whole branch and their connections", () => {
    addStar("odin", star("bob"));
    addStar("odin", star("mark", "bob"));
    addStar("odin", star("julia", "mark"));
    addStar("odin", star("tina"));
    addStar("odin", star("paulo", "tina"));
    apply("odin", { op: "addLink", link: { id: "l1", a: "julia", b: "paulo", relation: "cousin" } });
    apply("odin", { op: "removeStar", id: "mark" });
    const { stars, links } = sky.load("odin");
    expect(stars.map((s) => s.id)).toEqual(["bob", "tina", "paulo"]);
    expect(links).toEqual([]);
  });

  it("deletes a branch 1,500 levels deep", () => {
    addStar("odin", star("s0"));
    for (let i = 1; i <= 1500; i++) addStar("odin", star(`s${i}`, `s${i - 1}`));
    apply("odin", { op: "removeStar", id: "s0" });
    expect(names("odin")).toEqual([]);
  });

  it("promotes a relative to a main star, connected to the star it was tied to", () => {
    addStar("odin", star("bob"));
    addStar("odin", star("mark", "bob", { relation: "brother" }));
    addStar("odin", star("julia", "mark"));
    apply("odin", { op: "promoteStar", id: "mark", hue: 2, linkId: "l1" });
    const { stars, links } = sky.load("odin");
    expect(stars[1]).toMatchObject({ id: "mark", parent: null, relation: "", hue: 2 });
    expect(stars[2]).toMatchObject({ id: "julia", parent: "mark" });
    expect(links).toEqual([{ id: "l1", a: "bob", b: "mark", relation: "brother" }]);
    // The old parent can go now without taking the promoted star with it.
    apply("odin", { op: "removeStar", id: "bob" });
    expect(names("odin")).toEqual(["mark", "julia"]);
    expect(sky.load("odin").links).toEqual([]);
  });

  it("refuses bad stars", () => {
    addStar("odin", star("bob"));
    const bad: [Op, string][] = [
      [{ op: "addStar", star: star("bob") }, "already in use"],
      [{ op: "addStar", star: star("x", "nobody") }, "No such star"],
      [{ op: "addStar", star: star("no spaces") }, "valid id"],
      [{ op: "addStar", star: star("x", null, { name: "n".repeat(LIMITS.name + 1) }) }, "at most"],
      [{ op: "addStar", star: star("x", null, { memo: "m".repeat(LIMITS.memo + 1) }) }, "at most"],
      [{ op: "addStar", star: star("x", null, { hue: 6 }) }, "hue"],
      [{ op: "addStar", star: star("x", null, { hue: 1.5 }) }, "hue"],
      [{ op: "addStar", star: star("x", null, { x: Number.NaN }) }, "position"],
      [{ op: "addStar", star: star("x", null, { y: LIMITS.coordinate + 1 }) }, "position"],
      [{ op: "updateStar", id: "bob", relation: "brother" }, "main star has no relation"],
      [{ op: "updateStar", id: "nobody", name: "x" }, "No such star"],
      [{ op: "moveStars", moves: [{ id: "bob", x: 1, y: Infinity }] }, "position"],
      [{ op: "removeStar", id: "nobody" }, "No such star"],
      [{ op: "promoteStar", id: "bob", hue: 1, linkId: "l1" }, "already a main star"],
      [{ op: "nonsense" } as unknown as Op, "Unknown op"],
    ];
    for (const [op, message] of bad) expect(refusal(() => apply("odin", op)).message).toContain(message);
    expect(names("odin")).toEqual(["bob"]);
  });

  it("stops at the most stars a sky can have", () => {
    const insert = db.prepare(
      "INSERT INTO stars (id, owner, seq, x, y, created_at, updated_at) VALUES (?, 'odin', ?, 0, 0, '', '')",
    );
    for (let i = 0; i < LIMITS.starsPerUser; i++) insert.run(`s${i}`, i);
    const refused = refusal(() => addStar("odin", star("one-more")));
    expect(refused.status).toBe(409);
    expect(refused.code).toBe("too-many");
  });
});

describe("connections", () => {
  beforeEach(() => {
    addStar("odin", star("bob"));
    addStar("odin", star("carla", "bob"));
    addStar("odin", star("diego"));
    addStar("odin", star("laura", "diego"));
  });

  it("adds and removes a connection", () => {
    apply("odin", { op: "addLink", link: { id: "l1", a: "carla", b: "laura", relation: "sister" } });
    expect(sky.load("odin").links).toEqual([{ id: "l1", a: "carla", b: "laura", relation: "sister" }]);
    apply("odin", { op: "removeLink", id: "l1" });
    expect(sky.load("odin").links).toEqual([]);
  });

  it("refuses a star on itself, a tied pair, and the same pair either way round", () => {
    const link = (a: string, b: string): Op => ({ op: "addLink", link: { id: randomUUID(), a, b, relation: "" } });
    expect(refusal(() => apply("odin", link("bob", "bob"))).message).toContain("itself");
    expect(refusal(() => apply("odin", link("bob", "carla"))).message).toContain("tied");
    expect(refusal(() => apply("odin", link("carla", "bob"))).message).toContain("tied");
    apply("odin", link("carla", "laura"));
    expect(refusal(() => apply("odin", link("laura", "carla"))).message).toContain("already connected");
    expect(refusal(() => apply("odin", link("carla", "laura"))).message).toContain("already connected");
    expect(refusal(() => apply("odin", { op: "removeLink", id: "nobody" })).message).toContain("No such");
  });
});

describe("two users", () => {
  beforeEach(() => {
    addStar("odin", star("bob"));
    addStar("odin", star("mark", "bob"));
    addStar("freya", star("tina"));
    apply("odin", { op: "addStar", star: star("amanda") });
    apply("odin", { op: "addLink", link: { id: "l1", a: "bob", b: "amanda", relation: "cousin" } });
  });

  it("each sees only their own sky", () => {
    expect(names("odin")).toEqual(["bob", "mark", "amanda"]);
    expect(names("freya")).toEqual(["tina"]);
    expect(sky.load("freya").links).toEqual([]);
  });

  it("nobody can touch another user's stars or connections", () => {
    const attacks: Op[] = [
      { op: "updateStar", id: "bob", name: "Hacked" },
      { op: "moveStars", moves: [{ id: "bob", x: 9, y: 9 }] },
      { op: "removeStar", id: "bob" },
      { op: "promoteStar", id: "mark", hue: 1, linkId: "l2" },
      { op: "addStar", star: star("x", "bob") },
      { op: "addLink", link: { id: "l2", a: "tina", b: "bob", relation: "" } },
      { op: "removeLink", id: "l1" },
    ];
    for (const op of attacks) expect(refusal(() => apply("freya", op)).status).toBe(404);
    expect(sky.load("odin").stars[0]).toMatchObject({ name: "bob", x: 1 });
    expect(sky.load("odin").links).toHaveLength(1);
    // An id someone else has used can't be taken, and says nothing about whose it is.
    expect(refusal(() => apply("freya", { op: "addStar", star: star("bob") })).status).toBe(400);
  });

  it("removes the sky of a user who has left Heimdall", () => {
    expect(sky.removeUnknownOwners(new Set(["freya"]))).toEqual([{ owner: "odin", stars: 3 }]);
    expect(sky.load("odin")).toEqual({ stars: [], links: [], rev: 0 });
    expect(names("freya")).toEqual(["tina"]);
    expect(sky.removeUnknownOwners(new Set(["freya"]))).toEqual([]);
  });
});

describe("batches", () => {
  it("saves all of a batch or none of it", () => {
    addStar("odin", star("bob"));
    const before = sky.load("odin");
    const refused = refusal(() =>
      apply(
        "odin",
        { op: "addStar", star: star("mark", "bob") },
        { op: "updateStar", id: "bob", name: "Changed" },
        { op: "removeStar", id: "nobody" },
      ),
    );
    expect(refused.status).toBe(404);
    expect(sky.load("odin")).toEqual(before);
  });

  it("applies a batch sent twice only once", () => {
    const body = { batch: "b1", ops: [{ op: "addStar", star: star("bob") }] };
    expect(sky.applyOps("odin", body)).toEqual({ rev: 1 });
    expect(sky.applyOps("odin", body)).toEqual({ rev: 1 });
    expect(names("odin")).toEqual(["bob"]);
  });

  it("refuses a malformed request", () => {
    expect(refusal(() => sky.applyOps("odin", null)).status).toBe(400);
    expect(refusal(() => sky.applyOps("odin", { batch: "b", ops: "x" })).status).toBe(400);
    expect(refusal(() => sky.applyOps("odin", { ops: [] })).status).toBe(400);
    const ops = Array.from({ length: LIMITS.opsPerBatch + 1 }, () => ({ op: "removeLink", id: "x" }));
    expect(refusal(() => sky.applyOps("odin", { batch: "b", ops })).message).toContain("at most");
  });
});
