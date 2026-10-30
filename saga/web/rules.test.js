import { describe, expect, it } from "vitest";
import { ENEMIES, TIERS, TUNE } from "./data.js";
import {
  addHabit,
  addVice,
  defeatEnemy,
  joinParty,
  logVice,
  removeHabit,
  removeVice,
  seed,
  setHabitNote,
  sheetAttr,
  summaryOf,
  vicePreview,
} from "./rules.js";

describe("a new game", () => {
  it("starts with no companions, vices or tasks", () => {
    const s = seed({ name: "Rowan", avatar: "sage" });
    expect(s).toMatchObject({ habits: [], party: [], vices: [], tasks: [], hero: { name: "Rowan", gold: 80 } });
    expect(summaryOf(s)).toEqual({ level: 1, fame: 0, front: 0, dragonKills: 0, dragonKinds: 0, loops: 0, habits: 0 });
  });
});

describe("the ranking's summary", () => {
  it("counts fame, the road and the kinds of dragon slain", () => {
    const s = seed();
    const h = addHabit(s, { name: "Pilates", attr: "body" });
    joinParty(s, h.id);
    defeatEnemy(s);
    expect(summaryOf(s)).toMatchObject({ fame: 1, front: 1, habits: 1 });
    const dragon = ENEMIES.find((e) => e.tier === 8);
    s.defeated[dragon.key] = 2;
    expect(summaryOf(s).dragonKinds).toBe(1);
  });
});

describe("deleting", () => {
  it("takes a companion out of the party and its points off the hero's sheet", () => {
    const s = seed();
    const a = addHabit(s, { name: "Pilates", attr: "body" });
    const b = addHabit(s, { name: "Guitar", attr: "craft" });
    joinParty(s, a.id);
    joinParty(s, b.id);
    expect(sheetAttr(s, "craft")).toBe(3);
    removeHabit(s, b.id);
    expect(s.party).toEqual([a.id]);
    expect(s.habits.map((h) => h.name)).toEqual(["Pilates"]);
    expect(sheetAttr(s, "craft")).toBe(0);
  });

  it("keeps the points a vice already took", () => {
    const s = seed();
    addHabit(s, { name: "Pilates", attr: "body" });
    const v = addVice(s, { name: "Smoking", attr: "body", cost: 15, drain: 2 });
    logVice(s, v.id);
    removeVice(s, v.id);
    expect(s.vices).toEqual([]);
    expect(sheetAttr(s, "body")).toBe(1);
  });
});

describe("a companion's note", () => {
  it("starts empty, is trimmed and has a limit", () => {
    const s = seed();
    const h = addHabit(s, { name: "Pilates", attr: "body" });
    expect(h.note).toBe("");
    setHabitNote(s, h.id, "  Twice a week counts.  ");
    expect(h.note).toBe("Twice a week counts.");
    setHabitNote(s, h.id, "x".repeat(TUNE.noteMax + 10));
    expect(h.note.length).toBe(TUNE.noteMax);
  });
});

describe("the road", () => {
  it("tells of a region when the party first reaches it", () => {
    const s = seed();
    addHabit(s, { name: "Pilates", attr: "body" });
    for (let i = 0; i < 6; i++) defeatEnemy(s);
    expect(s.enemy.key).toBe(ENEMIES[6].key);
    expect(s.log.map((l) => l.text)).toContain(TIERS[1].lore);
  });

  it("begins again after the last foe", () => {
    const s = seed();
    addHabit(s, { name: "Pilates", attr: "body" });
    for (let i = 0; i < ENEMIES.length; i++) defeatEnemy(s);
    expect(s.loops).toBe(1);
    expect(s.enemy.star).toBe(1);
    expect(s.log[0].text).toContain("the rats are bigger");
  });
});

describe("logging a vice", () => {
  it("says beforehand what it will take", () => {
    const s = seed();
    addHabit(s, { name: "Pilates", attr: "body" });
    const v = addVice(s, { name: "Smoking", attr: "body", cost: 15, drain: 2 });
    expect(vicePreview(s, v)).toEqual({ drain: 2, cost: 15, canPay: true });
    s.hero.gold = 0;
    expect(vicePreview(s, v).canPay).toBe(false);
    const r = logVice(s, v.id, () => 0);
    expect(r.drained).toBe(2);
    expect(r.paid).toBe(0);
  });
});
