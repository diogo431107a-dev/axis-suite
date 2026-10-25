import { describe, expect, it } from "vitest";
import { ENEMIES } from "./data.js";
import { addHabit, defeatEnemy, joinParty, seed, summaryOf } from "./rules.js";

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
