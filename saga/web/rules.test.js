import { describe, expect, it } from "vitest";
import { ENEMIES, TIERS, TUNE } from "./data.js";
import {
  addHabit,
  addTask,
  addVice,
  angelFill,
  angelHere,
  attack,
  attackPower,
  castSpell,
  chooseAngel,
  closeTurn,
  defeatEnemy,
  endTurn,
  gameOver,
  isWiped,
  joinParty,
  logVice,
  maxHpOf,
  maxMpOf,
  memberGuard,
  removeHabit,
  removeVice,
  seed,
  setHabitNote,
  sheetAttr,
  strike,
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

describe("the Angel's place", () => {
  const party = (n = 1) => {
    const s = seed();
    const units = [];
    for (let i = 0; i < n; i++) {
      const h = addHabit(s, { name: "Habit " + i, attr: "body" });
      joinParty(s, h.id);
      units.push(h);
    }
    // A foe that won't fall during the test.
    s.enemy.maxHp = s.enemy.hp = 1e7;
    return { s, units };
  };
  const quiet = () => 0.5; // an average blow, and no critical hit
  const arrive = (s, who) => {
    chooseAngel(s, who);
    s.angel.left = TUNE.angel.turns;
  };
  const bite = { hits: [1, 1], size: "medium", name: "Bite", target: "one" };

  it("is chosen once, and only by name", () => {
    const { s } = party();
    expect(chooseAngel(s, "nobody")).toBe(false);
    expect(chooseAngel(s, "alecta")).toBe(true);
    expect(chooseAngel(s, "lunaria")).toBe(false);
    expect(s.angel.who).toBe("alecta");
  });

  it("does not fill until she is chosen, or on a turn with no deed", () => {
    const { s, units } = party();
    attack(s, units[0].id, quiet);
    endTurn(s, quiet);
    expect(s.angel.bar).toBe(0);
    chooseAngel(s, "lunaria");
    endTurn(s, quiet);
    endTurn(s, quiet);
    expect(s.angel.bar).toBe(0);
    units[0].hp = maxHpOf(units[0]);
    attack(s, units[0].id, quiet);
    endTurn(s, quiet);
    expect(s.angel.bar).toBeGreaterThan(0);
  });

  it("takes about 33 turns for a small party and about 22 for a full one", () => {
    expect(TUNE.angel.bar / angelFill(2, 0.05)).toBeCloseTo(33, -1);
    expect(TUNE.angel.bar / angelFill(5, 0.2)).toBeCloseTo(22, -1);
  });

  it("arrives on a full bar, stays 6 turns, then the bar starts again", () => {
    const { s, units } = party();
    chooseAngel(s, "lunaria");
    s.angel.bar = TUNE.angel.bar - 0.5;
    attack(s, units[0].id, quiet);
    endTurn(s, quiet);
    expect(s.angel).toMatchObject({ bar: 0, left: 6, arriving: true });
    for (let i = 6; i > 0; i--) {
      expect(angelHere(s)).toBe(true);
      attack(s, units[0].id, quiet);
      units[0].hp = maxHpOf(units[0]);
      endTurn(s, quiet);
      expect(s.angel.left).toBe(i - 1);
    }
    expect(angelHere(s)).toBe(false);
    expect(s.angel.bar).toBe(0);
  });

  it("leaves when the party falls", () => {
    const { s, units } = party();
    arrive(s, "lunaria");
    s.angel.arriving = true;
    units[0].hp = 0;
    expect(isWiped(s)).toBe(true);
    gameOver(s);
    expect(s.angel).toMatchObject({ left: 0, arriving: false });
  });

  it("gives Lunaria's extra attack damage only: one check-in and one deed", () => {
    const { s, units } = party();
    const u = units[0];
    const plain = attack(s, u.id, quiet).dmg;
    endTurn(s, quiet);
    arrive(s, "lunaria");
    const checkins = u.checkins;
    const hp = s.enemy.hp;
    const res = attack(s, u.id, quiet);
    expect(u.checkins).toBe(checkins + 1);
    expect(s.angel.deeds).toBe(1);
    expect(res.echo.dmg).toBe(Math.round(attackPower(u) * TUNE.angel.lunaria.echo));
    expect(hp - s.enemy.hp).toBe(plain + res.echo.dmg);
  });

  it("follows every action with the extra attack, and the foe does not counter it", () => {
    const { s, units } = party();
    const u = units[0];
    s.enemy.key = ENEMIES.find((e) => e.atk.counter).key;
    arrive(s, "lunaria");
    const r = memberGuard(s, u.id, quiet);
    expect(r.echo.dmg).toBeGreaterThan(0);
    expect(r.counter).toBeUndefined();
    endTurn(s, quiet);
    u.hp = maxHpOf(u);
    const t = addTask(s, { name: "Call the plumber", school: "force" });
    expect(castSpell(s, u.id, t.id, quiet).echo.dmg).toBeGreaterThan(0);
  });

  it("lets the extra attack win the battle, and doesn't strike a foe already beaten", () => {
    const { s, units } = party();
    const u = units[0];
    arrive(s, "lunaria");
    s.enemy.maxHp = 1000;
    s.enemy.hp = Math.round(attackPower(u)) + 1;
    const won = attack(s, u.id, quiet);
    expect(won.echo.dmg).toBeGreaterThan(0);
    expect(won.kill).toBeTruthy();
    expect(s.frontIndex).toBe(1);

    const next = party();
    arrive(next.s, "lunaria");
    next.s.enemy.hp = 1;
    const once = attack(next.s, next.units[0].id, quiet);
    expect(once.kill).toBeTruthy();
    expect(once.echo).toBeUndefined();
  });

  it("has Lunaria shelter the party and restore it each turn", () => {
    const { s, units } = party();
    const u = units[0];
    const bare = strike(s, u, bite, quiet).dmg;
    u.hp = maxHpOf(u);
    arrive(s, "lunaria");
    expect(strike(s, u, bite, quiet).dmg).toBe(Math.max(1, Math.round(bare * (1 - TUNE.angel.lunaria.shelter))));
    u.hp = 10;
    u.mp = 0;
    expect(closeTurn(s).regen).toEqual([
      { id: u.id, hp: Math.ceil(maxHpOf(u) * 0.1), mp: Math.ceil(maxMpOf(u) * 0.1) },
    ]);
  });

  it("has Alecta weaken the foe and sharpen the party's aim", () => {
    const { s, units } = party();
    const u = units[0];
    const bare = strike(s, u, bite, quiet).dmg;
    u.hp = maxHpOf(u);
    const plain = attack(s, u.id, quiet).dmg;
    endTurn(s, quiet);
    u.hp = maxHpOf(u);
    arrive(s, "alecta");
    expect(strike(s, u, bite, quiet).dmg).toBe(Math.max(1, Math.round(bare * (1 - TUNE.angel.alecta.unnerved))));
    u.hp = maxHpOf(u);
    const rolls = [0.5, 0.3]; // the spread, then the critical roll: no critical at 10%, a critical at 40%
    const res = attack(s, u.id, () => rolls.shift() ?? 0.5);
    expect(res.crit).toBe(true);
    expect(res.dmg).toBe(Math.round(Math.round(plain * 1.5) * TUNE.angel.alecta.exposed));
    expect(res.echo).toBeUndefined();
    expect(closeTurn(s).regen).toEqual([]);
  });

  it("comes back about every 40 turns for two companions acting every turn", () => {
    const { s, units } = party(2);
    chooseAngel(s, "alecta");
    let visits = 0;
    for (let t = 0; t < 330; t++) {
      for (const u of units) {
        u.hp = maxHpOf(u);
        attack(s, u.id, quiet);
      }
      s.enemy.hp = s.enemy.maxHp;
      endTurn(s, quiet);
      if (s.angel.arriving) {
        visits++;
        s.angel.arriving = false;
      }
    }
    expect(visits).toBeGreaterThanOrEqual(7);
    expect(visits).toBeLessThanOrEqual(10);
  });
});
