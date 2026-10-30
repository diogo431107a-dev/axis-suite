import {
  ANGELS,
  ATTR,
  ATTRS,
  ENEMIES,
  ENEMY_BY_KEY,
  ITEMS,
  MOVES,
  SCHOOLS,
  STATUSES,
  TIERS,
  TITLE_LADDER,
  TUNE,
  sfrac,
} from "./data.js";

/* =====================================================================
   RULES — plain functions over the state object. No DOM in here.
   This block is what carries over into the real project.
   ===================================================================== */
export const need = (L, base) => Math.max(1, Math.round(base * Math.pow(L, TUNE.curveExp)));
export function levelInfo(total, base) {
  let level = 1,
    rest = total,
    n = need(1, base);
  while (rest >= n) {
    rest -= n;
    level++;
    n = need(level, base);
  }
  return { level, into: rest, need: n, pct: rest / n };
}
export const lvOf = (u) => levelInfo(u.xp, TUNE.curve.comp);
export const masteryOf = (u) => levelInfo(u.checkins, TUNE.curve.mastery);
export const spellLvOf = (u) => levelInfo(u.casts, TUNE.curve.spell);
export const fleeLvOf = (u) => levelInfo(u.escapes, TUNE.curve.flee);
export const pointsOf = (u) => TUNE.pointsPerLevel * lvOf(u).level;
export const schoolOf = (u) => ATTR[u.attr].school;
export const maxHpOf = (u) => TUNE.hp[0] + TUNE.hp[1] * lvOf(u).level;
export const maxMpOf = (u) => TUNE.mp[0] + TUNE.mp[1] * lvOf(u).level;
export const spellCost = (u) => TUNE.spell.mpBase + spellLvOf(u).level;
export const findHabit = (s, id) => s.habits.find((h) => h.id === id);
export const findVice = (s, id) => s.vices.find((v) => v.id === id);
export const partyUnits = (s) => s.party.map((id) => findHabit(s, id)).filter(Boolean);
export const standing = (s) => partyUnits(s).filter((u) => !isKO(u));
export const isKO = (u) => u.hp <= 0;
export const hasStatus = (u, id) => u.statuses.some((x) => x.id === id);
export const actedThisTurn = (s, u) => u.lastActedTurn === s.turn;
export const canAct = (s, u) => !isKO(u) && !hasStatus(u, "freeze") && !actedThisTurn(s, u);
export const isWiped = (s) => s.party.length > 0 && partyUnits(s).every(isKO);
export const enemyDef = (e) => ENEMY_BY_KEY[e.key];
export const enemyName = (e) => enemyDef(e).name + (e.star ? " ★" + e.star : "");
export const atFront = (s) => s.enemy.index === s.frontIndex;
export const randInt = ([a, b], rng) => a + Math.floor(rng() * (b - a + 1));
export const openTasks = (s, school) => s.tasks.filter((t) => !t.done && (!school || t.school === school));

export function addLog(s, text) {
  s.log.unshift({ turn: s.turn, text });
  if (s.log.length > 80) s.log.length = 80;
}

/* ---------- the hero: a summary sheet of the companions ---------- */
// Each attribute is the total of every companion's points in it, minus what vices have taken.
export function sheetAttr(s, a) {
  const raw = s.habits.filter((h) => h.attr === a).reduce((t, h) => t + pointsOf(h), 0);
  return Math.max(0, raw - (s.vicePenalty[a] || 0));
}
export function heroInfo(s) {
  const total = ATTRS.reduce((t, a) => t + sheetAttr(s, a.id), 0);
  return { ...levelInfo(total, TUNE.curve.hero), total };
}

/* ---------- XP, HP and knockouts ---------- */
// Adds XP. A level-up clears the knockout streak and, as in classic RPGs, fully restores HP and MP.
export function gainXp(u, amount) {
  const lv0 = lvOf(u).level;
  u.xp += amount;
  const ups = lvOf(u).level - lv0;
  if (ups > 0) {
    u.koCount = 0;
    if (!isKO(u)) {
      u.hp = maxHpOf(u);
      u.mp = maxMpOf(u);
    }
  }
  return ups;
}
// Knockout costs a slice of the current level's XP, growing with repeats, never below the level's start.
export function koPenalty(u) {
  u.koCount = (u.koCount || 0) + 1;
  const k = TUNE.ko,
    share = Math.min(k.cap, k.first + k.step * (u.koCount - 1));
  const info = lvOf(u);
  const loss = Math.min(info.into, Math.round(share * info.need));
  u.xp -= loss;
  return loss;
}
export function applyDamage(s, u, dmg) {
  if (isKO(u)) return { ko: false, loss: 0 };
  u.hp = Math.max(0, u.hp - dmg);
  if (u.hp > 0) return { ko: false, loss: 0 };
  const loss = koPenalty(u);
  u.statuses = [];
  addLog(s, `${u.name} is knocked out${loss ? ` and loses ${loss} XP` : ""}.`);
  if (s.session) s.session.kos.push(u.name);
  return { ko: true, loss };
}
// The whole party fell: everyone wakes at camp with 1 HP. No gold is lost, but the foe recovers fully
// and all credit earned against it is gone.
export function gameOver(s) {
  for (const u of partyUnits(s)) {
    u.hp = Math.max(1, u.hp);
    u.statuses = [];
  }
  const e = s.enemy;
  e.hp = e.maxHp;
  e.eng = {};
  e.firstHit = null;
  e.insight = null;
  e.charmed = null;
  Object.assign(s.angel, { left: 0, arriving: false, deeds: 0, dealt: 0 });
  addLog(s, `The party falls, and wakes at camp with 1 HP each. ${enemyName(e)} stands whole again.`);
  if (s.session) s.session.gameOver = true;
}

/* ---------- engagement: the hidden measure that splits victory XP ---------- */
export function credit(s, id, pts) {
  if (!pts || !id) return;
  const e = s.enemy;
  e.eng[id] = (e.eng[id] || 0) + pts;
}

/* ---------- statuses ---------- */
export function applyStatus(u, id) {
  const turns = STATUSES[id].turns;
  const cur = u.statuses.find((x) => x.id === id);
  if (cur) cur.left = turns;
  else u.statuses.push({ id, left: turns });
}
export function cureStatus(u, ids) {
  const before = u.statuses.length;
  u.statuses = ids ? u.statuses.filter((x) => !ids.includes(x.id)) : [];
  return before - u.statuses.length;
}
// One random ailment, on one random standing party member or (1 in 3) the whole party.
export function randomAilment(s, rng) {
  const pool = standing(s);
  if (!pool.length) return null;
  const ids = Object.keys(STATUSES);
  const id = ids[Math.floor(rng() * ids.length)];
  const targets = rng() < TUNE.status.wholeParty ? pool : [pool[Math.floor(rng() * pool.length)]];
  targets.forEach((u) => applyStatus(u, id));
  return { id, names: targets.map((u) => u.name), whole: targets.length > 1 };
}
// End of turn: poison bites party members, then every timed ailment counts down.
export function tickStatuses(s) {
  const ticks = [];
  for (const u of standing(s)) {
    if (hasStatus(u, "poison")) {
      const dmg = Math.max(1, Math.ceil(maxHpOf(u) * TUNE.status.poison));
      const r = applyDamage(s, u, dmg);
      ticks.push({ id: u.id, name: u.name, dmg, ko: r.ko });
    }
  }
  for (const u of s.habits) {
    u.statuses = u.statuses
      .map((x) => (x.left == null ? x : { ...x, left: x.left - 1 }))
      .filter((x) => x.left == null || x.left > 0);
  }
  return ticks;
}

/* ---------- the Angel's place ---------- */
// The hero's one choice of who stands there. It holds for this hero's whole road.
export function chooseAngel(s, who) {
  if (s.angel.who || !ANGELS[who]) return false;
  s.angel.who = who;
  addLog(
    s,
    who === "lunaria" ? "Lunaria takes what is hers by right." : "Alecta takes what was never hers, and smiles.",
  );
  return true;
}
export const angelHere = (s, who) => s.angel.left > 0 && (!who || s.angel.who === who);
// What the bar gains from a turn: nothing without a deed, or it could be filled without doing a habit.
export function angelFill(deeds, dealt) {
  const F = TUNE.angel.fill;
  return deeds ? F.turn + F.perDeed * deeds + F.damage * Math.min(1, dealt) : 0;
}
// End of turn. While she stays, Lunaria restores the party and the turns count down. Otherwise the bar
// fills, and a full bar brings her for the turns that follow. Returns what was restored, by member.
export function angelTurn(s) {
  const a = s.angel,
    A = TUNE.angel,
    gain = angelFill(a.deeds, a.dealt);
  a.deeds = 0;
  a.dealt = 0;
  if (!a.who) return [];
  if (a.left === 0) {
    a.bar = Math.min(A.bar, a.bar + gain);
    if (a.bar === A.bar) {
      a.bar = 0;
      a.left = A.turns;
      a.arriving = true;
      addLog(s, ANGELS[a.who].arrives);
    }
    return [];
  }
  const regen = [];
  if (a.who === "lunaria")
    for (const u of standing(s)) {
      const hp = Math.min(maxHpOf(u) - u.hp, Math.ceil(maxHpOf(u) * A.lunaria.regen));
      const mp = Math.min(maxMpOf(u) - u.mp, Math.ceil(maxMpOf(u) * A.lunaria.regen));
      u.hp += hp;
      u.mp += mp;
      if (hp || mp) regen.push({ id: u.id, hp, mp });
    }
  a.left--;
  if (a.left === 0) addLog(s, ANGELS[a.who].leaves);
  return regen;
}
// Beside Lunaria, whoever has just acted strikes once more. It is a blow and no more: the habit was
// not done again, so it records nothing and raises no mastery.
export function angelEcho(s, u, res, rng) {
  if (!angelHere(s, "lunaria") || res.kill || res.gameOver || isKO(u)) return res;
  let dmg = attackPower(u) * TUNE.angel.lunaria.echo * (0.9 + rng() * 0.2);
  if (hasStatus(u, "shock")) dmg /= 2;
  const target = enemyName(s.enemy);
  const hit = hitFoe(s, u, Math.round(dmg), rng, { counters: false });
  addLog(s, `${u.name} strikes ${target} again for ${hit.dmg}.`);
  res.echo = { dmg: hit.dmg, hpAfter: hit.hpAfter };
  res.kill = hit.kill;
  res.gameOver = hit.gameOver;
  return res;
}

/* ---------- foes ---------- */
export function spawnEnemy(index) {
  const def = ENEMIES[index % ENEMIES.length];
  const star = Math.floor(index / ENEMIES.length);
  const maxHp = Math.round(def.hp * (1 + TUNE.enemyHp.perStar * star));
  return { index, key: def.key, star, maxHp, hp: maxHp, eng: {}, firstHit: null, insight: null, charmed: null };
}
export function foeReward(e) {
  const def = enemyDef(e),
    R = TUNE.reward;
  return {
    xp: Math.round(R.xp * Math.pow(R.growth, def.tier - 1) * (1 + R.perIndex * def.idx) * (1 + R.perStar * e.star)),
    gold: R.gold * def.tier * (1 + e.star),
  };
}
export function enemyUnit(e) {
  const D = TUNE.enemyDmg;
  return D.base * Math.pow(D.growth, enemyDef(e).tier - 1) * (1 + D.perStar * e.star);
}
export function hitDamage(e, move, rng) {
  return Math.max(1, Math.round(enemyUnit(e) * TUNE.size[move.size] * (0.8 + rng() * 0.4)));
}
// One foe move landing on one member. Insight, Ward and Guard each shave damage, and whoever
// provided the protection gets credit for what it prevented.
export function strike(s, u, move, rng, insight) {
  const hits = randInt(move.hits, rng);
  let dmg = 0;
  for (let i = 0; i < hits; i++) dmg += hitDamage(s.enemy, move, rng);
  const shave = (mult, by) => {
    const after = Math.max(1, Math.round(dmg * mult));
    credit(s, by, dmg - after);
    dmg = after;
  };
  if (insight) shave(insight.mult, insight.by);
  if (s.ward && s.ward.turn === s.turn) shave(s.ward.share, s.ward.by);
  const guarded = u.guardTurn === s.turn;
  if (guarded) shave(TUNE.guardShare, u.id);
  if (angelHere(s, "lunaria")) shave(1 - TUNE.angel.lunaria.shelter);
  if (angelHere(s, "alecta")) shave(1 - TUNE.angel.alecta.unnerved);
  const r = applyDamage(s, u, dmg);
  if (s.session) s.session.dmgTaken += dmg;
  return { id: u.id, name: u.name, move: move.name, hits, dmg, ko: r.ko, loss: r.loss, guarded };
}
// The foe hits back right after taking a hit (only if it survived).
export function enemyCounter(s, actor, rng) {
  const move = MOVES[enemyDef(s.enemy).atk.counter];
  if (!move) return [];
  const targets = move.target === "all" ? standing(s) : isKO(actor) ? [] : [actor];
  const foe = enemyName(s.enemy);
  return targets.map((u) => {
    const ev = strike(s, u, move, rng);
    addLog(s, `${foe} hits back: ${u.name} takes ${ev.dmg}.`);
    return ev;
  });
}
// The foe's own turn, after the party's.
export function foeTurn(s, rng) {
  const e = s.enemy;
  if (e.charmed) {
    const by = e.charmed;
    e.charmed = null;
    credit(s, by, Math.round(enemyUnit(e) * 1.5 * Math.max(1, standing(s).length)));
    addLog(s, `${enemyName(e)} is charmed and loses its turn.`);
    return { events: [], charmed: true };
  }
  const insight = e.insight;
  e.insight = null;
  const atk = enemyDef(e).atk;
  const keys = atk.pick ? [atk.turn[Math.floor(rng() * atk.turn.length)]] : atk.turn;
  const events = [];
  for (const k of keys) {
    const move = MOVES[k];
    const alive = standing(s);
    if (!alive.length) break;
    const targets = move.target === "all" ? alive : [alive[Math.floor(rng() * alive.length)]];
    for (const u of targets) events.push(strike(s, u, move, rng, insight));
  }
  return { events, charmed: false };
}
// True when no one left in the party can still act this turn.
export function turnDone(s) {
  return s.party.length > 0 && !partyUnits(s).some((u) => canAct(s, u));
}
// Closes the turn: ailments tick, a wipe means Game Over, and the turn number goes up.
export function closeTurn(s) {
  const ticks = tickStatuses(s);
  const over = isWiped(s);
  const regen = over ? [] : angelTurn(s);
  if (over) gameOver(s);
  s.turn++;
  if (s.session) s.session.turns++;
  return { ticks, over, regen };
}
// The foe takes its turn, then the turn closes.
export function endTurn(s, rng = Math.random) {
  const foe = enemyName(s.enemy),
    turn = s.turn;
  const { events, charmed } = foeTurn(s, rng);
  const total = events.reduce((a, e) => a + e.dmg, 0);
  if (events.length)
    addLog(
      s,
      `${foe} attacks: ${events
        .map((e) => e.move)
        .filter((m, i, a) => a.indexOf(m) === i)
        .join(", ")} for ${total} damage.`,
    );
  const { ticks, over, regen } = closeTurn(s);
  s.lastTurn = { turn, foe, events, ticks, regen, charmed, gameOver: over, dismissed: false };
  return s.lastTurn;
}

/* ---------- acting ---------- */
// Every action spends the member's turn; Burn hurts whoever acts while burning.
export function spendAction(s, u) {
  u.lastActedTurn = s.turn;
  if (!hasStatus(u, "burn")) return 0;
  const burn = Math.max(1, Math.ceil(maxHpOf(u) * TUNE.status.burn));
  applyDamage(s, u, burn);
  addLog(s, `${u.name} burns for ${burn}.`);
  return burn;
}
export function attackPower(u) {
  const D = TUNE.dmg;
  return (
    (D.base + D.perLevel * lvOf(u).level + D.perPoint * pointsOf(u)) * Math.pow(1 + D.mastery, masteryOf(u).level - 1)
  );
}
// Damage landing on the foe: Alecta's attention, Anthem bonus, first/last-hit credit, then victory or a counter.
export function hitFoe(s, u, dmg, rng, { counters = true } = {}) {
  const e = s.enemy,
    hpBefore = e.hp;
  if (angelHere(s, "alecta")) dmg = Math.round(dmg * TUNE.angel.alecta.exposed);
  if (s.anthem && s.anthem.turn === s.turn) {
    const extra = Math.round(dmg * s.anthem.bonus);
    dmg += extra;
    if (s.anthem.by !== u.id) credit(s, s.anthem.by, extra);
  }
  e.hp = Math.max(0, e.hp - dmg);
  const dealt = hpBefore - e.hp;
  credit(s, u.id, dealt);
  s.angel.dealt += dealt / e.maxHp;
  if (dealt > 0 && !e.firstHit) {
    e.firstHit = u.id;
    credit(s, u.id, Math.round(e.maxHp * TUNE.share.firstHit));
  }
  if (s.session) s.session.dmg += dealt;
  let kill = null,
    counter = [],
    over = false;
  if (e.hp === 0) {
    credit(s, u.id, Math.round(e.maxHp * TUNE.share.lastHit));
    kill = defeatEnemy(s);
    over = closeTurn(s).over; // victory ends the battle and the turn
  } else {
    if (counters) counter = enemyCounter(s, u, rng);
    over = isWiped(s);
    if (over) gameOver(s);
  }
  return { dmg: dealt, hpBefore, hpAfter: hpBefore - dealt, kill, counter, gameOver: over };
}
// Attack = "I just did this habit once". It pays nothing now, but sharpens the companion's mastery.
export function attack(s, id, rng = Math.random) {
  const u = findHabit(s, id);
  if (!u || !s.party.includes(id) || !canAct(s, u)) return null;
  const m0 = masteryOf(u).level;
  let dmg = attackPower(u) * (0.9 + rng() * 0.2);
  const crit = rng() < (angelHere(s, "alecta") ? TUNE.angel.alecta.crit : TUNE.crit);
  if (crit) dmg *= 1.5;
  if (hasStatus(u, "shock")) dmg /= 2;
  const miss = hasStatus(u, "blind") && rng() < TUNE.status.blindMiss;
  const target = enemyName(s.enemy);
  u.checkins++;
  s.angel.deeds++;
  const masteryUp = masteryOf(u).level > m0;
  const burn = spendAction(s, u);
  if (s.session) s.session.acted.push(id);
  let hit = { dmg: 0, hpBefore: s.enemy.hp, hpAfter: s.enemy.hp, kill: null, counter: [], gameOver: false };
  if (miss) {
    addLog(s, `${u.name} misses ${target} (blinded), but the habit counts.`);
    hit.gameOver = isWiped(s);
    if (hit.gameOver) gameOver(s);
  } else {
    hit = hitFoe(s, u, Math.round(dmg), rng);
    addLog(s, `${u.name} hits ${target} for ${hit.dmg}${crit ? " (critical!)" : ""}.`);
  }
  return angelEcho(s, u, { u, crit, miss, burn, masteryUp, ...hit }, rng);
}
// Casting = "I just finished this task". The task leaves the spellbook and the companion's spell level grows.
export function castSpell(s, id, taskId, rng = Math.random) {
  const u = findHabit(s, id),
    t = s.tasks.find((x) => x.id === taskId && !x.done);
  if (!u || !t || !s.party.includes(id) || !canAct(s, u) || t.school !== schoolOf(u)) return null;
  const cost = spellCost(u);
  if (u.mp < cost) return null;
  const L = spellLvOf(u).level,
    f = sfrac(L),
    sc = t.school;
  u.mp -= cost;
  u.casts++;
  s.angel.deeds++;
  const levelUp = spellLvOf(u).level > L;
  t.done = true;
  t.doneTurn = s.turn;
  t.by = u.name;
  const burn = spendAction(s, u);
  addLog(s, `${u.name} casts ${SCHOOLS[sc].name}: “${t.name}” is done.`);
  if (s.session) s.session.casts.push(t.name);
  const res = {
    u,
    task: t,
    school: sc,
    level: L,
    levelUp,
    cost,
    burn,
    effects: [],
    kill: null,
    counter: [],
    gameOver: false,
    dmg: 0,
  };
  const allies = standing(s);
  if (sc === "force" || sc === "finish") {
    let mult = sc === "force" ? 0.3 + 1.6 * f : (0.2 + 1.2 * f) * (1 + 2 * (1 - s.enemy.hp / s.enemy.maxHp));
    let dmg = attackPower(u) * mult * (0.9 + rng() * 0.2);
    if (hasStatus(u, "shock")) dmg /= 2;
    Object.assign(res, hitFoe(s, u, Math.round(dmg), rng));
    return angelEcho(s, u, res, rng);
  }
  if (sc === "mend" || sc === "purge") {
    const cures =
      sc === "purge"
        ? L >= 3
          ? null
          : L === 2
            ? ["poison", "burn", "shock", "blind"]
            : ["poison", "burn"]
        : undefined;
    const healShare = sc === "mend" ? 0.4 * f : 0.2 * f;
    for (const m of allies) {
      const amt = Math.min(maxHpOf(m) - m.hp, Math.ceil(maxHpOf(m) * healShare));
      m.hp += amt;
      credit(s, u.id, amt);
      let text = amt ? "+" + amt : "";
      if (cures !== undefined) {
        const n = cureStatus(m, cures);
        credit(s, u.id, Math.round(maxHpOf(m) * 0.1 * n));
        if (n) text = "CURED";
      }
      if (text) res.effects.push({ id: m.id, text });
    }
  } else if (sc === "insight") {
    s.enemy.insight = { mult: 1 - 0.7 * f, by: u.id };
    res.effects.push({ foe: true, text: "WEAKENED" });
  } else if (sc === "anthem") {
    s.anthem = { turn: s.turn, bonus: 0.8 * f, by: u.id };
    allies.forEach((m) => res.effects.push({ id: m.id, text: "ANTHEM" }));
  } else if (sc === "ward") {
    s.ward = { turn: s.turn, share: 1 - Math.min(0.75, 0.9 * f), by: u.id };
    allies.forEach((m) => res.effects.push({ id: m.id, text: "WARD" }));
  } else if (sc === "charm") {
    const ok = rng() < 0.7 * f;
    if (ok) s.enemy.charmed = u.id;
    res.charmed = ok;
    res.effects.push({ foe: true, text: ok ? "CHARMED" : "RESISTED" });
  }
  res.gameOver = isWiped(s);
  if (res.gameOver) gameOver(s);
  return angelEcho(s, u, res, rng);
}
// Any member can spend its action on an item for a party member, or on guarding.
export function memberItem(s, userId, key, targetId, rng = Math.random) {
  const user = findHabit(s, userId);
  if (!user || !s.party.includes(userId) || !canAct(s, user) || !s.party.includes(targetId)) return null;
  const r = applyItem(s, key, targetId);
  if (!r) return null;
  credit(s, userId, r.value);
  r.burn = spendAction(s, user);
  r.gameOver = isWiped(s);
  if (r.gameOver) gameOver(s);
  return angelEcho(s, user, r, rng);
}
export function memberGuard(s, id, rng = Math.random) {
  const u = findHabit(s, id);
  if (!u || !s.party.includes(id) || !canAct(s, u)) return null;
  u.guardTurn = s.turn;
  const burn = spendAction(s, u);
  addLog(s, `${u.name} guards.`);
  const over = isWiped(s);
  if (over) gameOver(s);
  return angelEcho(s, u, { burn, gameOver: over }, rng);
}

/* ---------- victory ---------- */
// The foe's XP is split among the standing members: a small even floor, the rest by engagement.
export function payout(s, e) {
  const { xp, gold } = foeReward(e);
  const earners = standing(s).filter((u) => !hasStatus(u, "curse"));
  const total = earners.reduce((t, u) => t + (e.eng[u.id] || 0), 0);
  const F = TUNE.share.floor;
  const gains = earners.map((u) => {
    const share = F / earners.length + (1 - F) * (total ? (e.eng[u.id] || 0) / total : 1 / earners.length);
    const amt = Math.round(xp * share);
    const lv0 = lvOf(u).level;
    gainXp(u, amt);
    return { id: u.id, name: u.name, xp: amt, lv0, lv1: lvOf(u).level };
  });
  s.hero.gold += gold;
  return { xp, gold, gains };
}
export function defeatEnemy(s) {
  const killed = { ...s.enemy, hp: 0 },
    def = enemyDef(killed);
  const pay = payout(s, killed);
  s.defeated[killed.key] = (s.defeated[killed.key] || 0) + 1;
  s.fame += def.tier * (1 + killed.star);
  if (def.tier === 8) s.dragonKills++;
  s.vices.forEach((v) => {
    v.heat = Math.max(0, v.heat - 1);
  });
  addLog(s, `${enemyName(killed)} is defeated. +${pay.xp} XP shared, +${pay.gold} gold.`);
  if (s.session) {
    s.session.kills.push(killed.key);
    s.session.payout = pay;
  }
  if (killed.index < s.frontIndex) {
    s.enemy = s.frontSaved || spawnEnemy(s.frontIndex);
    s.frontSaved = null;
    addLog(s, `Back to the front: ${enemyName(s.enemy)} is waiting.`);
  } else {
    if (killed.index % ENEMIES.length === ENEMIES.length - 1) s.loops++;
    s.frontIndex = killed.index + 1;
    s.enemy = spawnEnemy(s.frontIndex);
    s.seen[s.enemy.key] = true;
    addLog(s, `${enemyName(s.enemy)} blocks the path.`);
    if (enemyDef(s.enemy).idx === 0) addLog(s, TIERS[enemyDef(s.enemy).tier - 1].lore);
    if (killed.index % ENEMIES.length === ENEMIES.length - 1)
      addLog(s, "The road begins again in the meadows, and the rats are bigger.");
  }
  return { killed, pay };
}

/* ---------- fleeing (the odds are never shown) ---------- */
export const partyFleeLv = (s) => Math.max(1, ...standing(s).map((u) => fleeLvOf(u).level));
// The escape is led by the standing companion with the best flee skill (ties: most progress, then highest level).
export function fleeLeader(s) {
  return (
    standing(s).sort(
      (a, b) => fleeLvOf(b).level - fleeLvOf(a).level || b.escapes - a.escapes || lvOf(b).level - lvOf(a).level,
    )[0] || null
  );
}
export function fleeChance(s) {
  const F = TUNE.flee,
    def = enemyDef(s.enemy);
  const c =
    F.base -
    F.perTier * (def.tier - 1) -
    (def.idx === 5 ? F.boss : 0) -
    F.perStar * s.enemy.star +
    F.perSkill * (partyFleeLv(s) - 1);
  return Math.min(F.max, Math.max(F.min, c));
}
// Only a successful escape trains flee, and only for the companion who led it, one step at a time.
// Success never drops gold. Failure costs the party its turn and may scatter some coins.
export function attemptFlee(s, rng = Math.random) {
  const skill = partyFleeLv(s),
    chance = fleeChance(s),
    foe = enemyName(s.enemy),
    F = TUNE.flee;
  if (rng() < chance) {
    const leader = fleeLeader(s);
    if (leader) leader.escapes++;
    addLog(s, `${leader ? leader.name + " leads" : "The party makes"} the escape from ${foe}.`);
    if (s.session) s.session.fled = true;
    return { ok: true, leader: leader && leader.id, gameOver: closeTurn(s).over };
  }
  for (const u of partyUnits(s)) u.lastActedTurn = s.turn;
  let dropped = 0;
  if (s.hero.gold > 0 && rng() < Math.max(F.dropMin, F.drop - F.dropPerSkill * (skill - 1))) {
    const share = F.dropShare[0] + rng() * (F.dropShare[1] - F.dropShare[0]);
    dropped = Math.min(s.hero.gold, Math.max(1, Math.round(s.hero.gold * share)));
    s.hero.gold -= dropped;
  }
  addLog(s, `The party tries to flee from ${foe} but is cut off${dropped ? `, dropping ${dropped} gold` : ""}.`);
  if (s.session) s.session.dropped += dropped;
  return { ok: false, dropped };
}

/* ---------- travel (camp only) ---------- */
// Foes you can travel back to: the strongest version of each kind already passed on the road.
export function travelOptions(s) {
  const best = {};
  for (let i = 0; i < s.frontIndex; i++) best[ENEMIES[i % ENEMIES.length].key] = i;
  return Object.values(best)
    .filter((i) => i !== s.enemy.index)
    .sort((a, b) => (a % ENEMIES.length) - (b % ENEMIES.length));
}
export function travelTo(s, index) {
  if (index >= s.frontIndex || index === s.enemy.index) return false;
  if (atFront(s)) s.frontSaved = s.enemy;
  s.enemy = spawnEnemy(index);
  addLog(s, `The party travels to ${TIERS[enemyDef(s.enemy).tier - 1].region} to face ${enemyName(s.enemy)}.`);
  return true;
}
export function returnToFront(s) {
  if (atFront(s)) return false;
  s.enemy = s.frontSaved || spawnEnemy(s.frontIndex);
  s.frontSaved = null;
  addLog(s, `The party returns to the front to face ${enemyName(s.enemy)}.`);
  return true;
}
export const frontPreview = (s) => (atFront(s) ? s.enemy : s.frontSaved || spawnEnemy(s.frontIndex));
export function skipTier(s) {
  s.frontSaved = null;
  s.frontIndex = (Math.floor(s.frontIndex / 6) + 1) * 6;
  s.enemy = spawnEnemy(s.frontIndex);
  s.seen[s.enemy.key] = true;
  addLog(s, `The party marches on. ${enemyName(s.enemy)} blocks the path.`);
}

/* ---------- fame and ranks ---------- */
export function fameTitle({ fame, dragonKills, dragonKinds, loops, name }) {
  if (loops > 0) return "Hero of a Thousand Mornings";
  if (dragonKinds >= 6) return `${name} the Unbroken, Dragonslayer of the Ember Peaks`;
  if (dragonKills >= 3) return "Dragonslayer of the Ember Peaks";
  if (dragonKills >= 1) return "Dragonslayer";
  let title = TITLE_LADDER[0][1];
  for (const [f, t] of TITLE_LADDER) if (fame >= f) title = t;
  return title;
}
// Who is saying it: the mockery of the first weeks gives way to the songs.
export const titleVoice = (s) => (s.fame < 25 ? "The villagers call you" : "The songs call you");
export function titleOf(s) {
  const dragonKinds = ENEMIES.filter((e) => e.tier === 8 && s.defeated[e.key]).length;
  return fameTitle({ fame: s.fame, dragonKills: s.dragonKills, dragonKinds, loops: s.loops, name: s.hero.name });
}
export const regionReached = (frontIndex) =>
  TIERS[Math.floor((frontIndex % ENEMIES.length) / 6)].region +
  (frontIndex >= ENEMIES.length ? " ★" + Math.floor(frontIndex / ENEMIES.length) : "");
// The numbers the public ranking is made of. Sent to the server with every save.
export function summaryOf(s) {
  return {
    level: heroInfo(s).level,
    fame: s.fame,
    front: s.frontIndex,
    dragonKills: s.dragonKills,
    dragonKinds: ENEMIES.filter((e) => e.tier === 8 && s.defeated[e.key]).length,
    loops: s.loops,
    habits: s.habits.length,
  };
}

/* ---------- items, inn ---------- */
export function buyItem(s, key) {
  const price = TUNE.items[key].price;
  if (s.hero.gold < price) return false;
  s.hero.gold -= price;
  s.bag[key]++;
  addLog(s, `Bought a${/^[AEIOU]/.test(ITEMS[key].name) ? "n" : ""} ${ITEMS[key].name} for ${price} gold.`);
  return true;
}
export function canUse(key, u) {
  if (key === "potion") return !isKO(u) && u.hp < maxHpOf(u);
  if (key === "ether") return !isKO(u) && u.mp < maxMpOf(u);
  if (key === "antidote") return hasStatus(u, "poison");
  if (key === "remedy") return u.statuses.length > 0;
  return isKO(u);
}
// Returns the text and a value (HP, MP or cure worth) used as engagement credit when used in battle.
export function applyItem(s, key, id) {
  const u = findHabit(s, id);
  if (!u || !s.bag[key] || !canUse(key, u)) return null;
  s.bag[key]--;
  const max = maxHpOf(u);
  let text, value;
  if (key === "potion") {
    value = Math.min(max - u.hp, Math.ceil(max * TUNE.items.potion.heal));
    u.hp += value;
    text = `${u.name} drinks a Health Potion (+${value} HP).`;
  } else if (key === "ether") {
    value = Math.min(maxMpOf(u) - u.mp, TUNE.items.ether.mp);
    u.mp += value;
    text = `${u.name} drinks an Ether (+${value} MP).`;
  } else if (key === "antidote" || key === "remedy") {
    value = Math.round(max * 0.1 * cureStatus(u, key === "antidote" ? ["poison"] : null));
    text = `${u.name} takes ${key === "antidote" ? "an Antidote" : "a Remedy"} and feels clear.`;
  } else {
    u.hp = key === "feather" ? 1 : Math.max(1, Math.ceil(max * TUNE.items.eliteFeather.revive));
    value = u.hp + Math.round(max * 0.2);
    text = `${u.name} rises again with ${u.hp} HP.`;
  }
  addLog(s, text);
  return { u, text, value };
}
// Inns are priced by the region the party is in, so travelling back to an easy region is a cheap way to recover.
export const innCost = (s) => TUNE.innPerTier * enemyDef(s.enemy).tier;
export const innNeeded = (s) =>
  s.habits.some((u) => !isKO(u) && (u.hp < maxHpOf(u) || u.mp < maxMpOf(u) || u.statuses.length));
// The inn restores every standing member's HP and MP and cures their ailments. It never revives.
export function restAtInn(s) {
  const cost = innCost(s);
  if (s.hero.gold < cost || !innNeeded(s)) return false;
  s.hero.gold -= cost;
  for (const u of s.habits)
    if (!isKO(u)) {
      u.hp = maxHpOf(u);
      u.mp = maxMpOf(u);
      u.statuses = [];
    }
  addLog(s, `The party rests at the inn for ${cost} gold and wakes refreshed.`);
  return true;
}

/* ---------- vices ---------- */
// Heat makes repeats hurt more: cost and drain grow by heatGrowth per heat. Each victory cools every vice by 1.
export function viceNow(v) {
  const m = Math.pow(TUNE.vice.heatGrowth, v.heat);
  return { cost: Math.round(v.cost * m), drain: Math.max(1, Math.round(v.drain * m)) };
}
export function addVice(s, { name, attr, cost, drain }) {
  const v = { id: "v" + s.nextVid++, name, attr, cost, drain, heat: 0, count: 0 };
  s.vices.push(v);
  addLog(s, `${name} is named a vice.`);
  return v;
}
// Stops tracking a vice. The points it already took from the hero's sheet stay taken.
export function removeVice(s, id) {
  const v = findVice(s, id);
  if (!v) return null;
  s.vices = s.vices.filter((x) => x.id !== id);
  addLog(s, `${v.name} is no longer named a vice.`);
  return v;
}
// What logging a vice would do now, for asking before it is logged.
export function vicePreview(s, v) {
  const now = viceNow(v);
  return { drain: Math.min(now.drain, sheetAttr(s, v.attr)), cost: now.cost, canPay: s.hero.gold >= now.cost };
}
// Logging a vice is never blocked and never uses a turn. It takes points from the hero's sheet,
// charges gold, and if the purse can't cover it, an ailment strikes.
export function logVice(s, id, rng = Math.random) {
  const v = findVice(s, id);
  if (!v) return null;
  const now = viceNow(v);
  const hero0 = heroInfo(s).level;
  const drained = Math.min(now.drain, sheetAttr(s, v.attr));
  s.vicePenalty[v.attr] = (s.vicePenalty[v.attr] || 0) + drained;
  v.count++;
  v.heat++;
  let paid = 0,
    ailment = null;
  if (s.hero.gold >= now.cost) {
    s.hero.gold -= now.cost;
    paid = now.cost;
  } else ailment = randomAilment(s, rng);
  const hero1 = heroInfo(s).level;
  const a = ATTR[v.attr];
  let text = `${v.name}: ${a.name} −${drained}${hero1 < hero0 ? ` (hero drops to LV ${hero1})` : ""}`;
  text +=
    paid || !now.cost
      ? `, −${paid} gold.`
      : ailment
        ? `. No gold to pay, so ${STATUSES[ailment.id].name} strikes ${ailment.whole ? "the whole party" : ailment.names[0]}.`
        : ". No gold to pay.";
  addLog(s, text);
  if (s.session) s.session.vices.push(v.name);
  return { v, drained, paid, ailment, hero0, hero1, text };
}

/* ---------- tasks (spells) ---------- */
export function addTask(s, { name, school }) {
  const t = { id: "t" + s.nextTid++, name, school, done: false, doneTurn: 0, by: "" };
  s.tasks.push(t);
  return t;
}
export function removeTask(s, id) {
  s.tasks = s.tasks.filter((t) => t.id !== id || t.done);
}

/* ---------- party and roster ---------- */
export function joinParty(s, id) {
  if (s.party.includes(id)) return "already";
  if (s.party.length >= TUNE.partySize) return "full";
  s.party.push(id);
  return "ok";
}
export function benchMember(s, id) {
  s.party = s.party.filter((x) => x !== id);
}
export function swapMember(s, outId, inId) {
  const i = s.party.indexOf(outId);
  if (i >= 0 && !s.party.includes(inId)) s.party[i] = inId;
}
export function newHabit(id, name, attr, xp = 0, checkins = 0) {
  const h = {
    id,
    name,
    attr,
    xp,
    checkins,
    casts: 0,
    escapes: 0,
    lastActedTurn: 0,
    guardTurn: 0,
    hp: 0,
    mp: 0,
    koCount: 0,
    statuses: [],
    note: "",
  };
  h.hp = maxHpOf(h);
  h.mp = maxMpOf(h);
  return h;
}
export function addHabit(s, { name, attr }) {
  const h = newHabit("h" + s.nextId++, name, attr);
  s.habits.push(h);
  addLog(s, `${name} answers, and walks with you as a ${ATTR[attr].cls}.`);
  return h;
}
// A companion's note: why this habit, what counts as doing it, what the current goal is.
export function setHabitNote(s, id, text) {
  const h = findHabit(s, id);
  if (h) h.note = String(text).trim().slice(0, TUNE.noteMax);
  return h;
}
// Deletes a companion for good: it leaves the party and the roster, and the attribute points it
// carried leave the hero's sheet with it, so the hero's level may drop. Fame stays.
export function removeHabit(s, id) {
  const h = findHabit(s, id);
  if (!h) return null;
  s.habits = s.habits.filter((x) => x.id !== id);
  s.party = s.party.filter((x) => x !== id);
  addLog(s, `${h.name} leaves the roster for good.`);
  return h;
}

/* ---------- battle sessions ---------- */
export function startSession(s) {
  s.session = {
    title0: titleOf(s),
    hero0: heroInfo(s).level,
    gold0: s.hero.gold,
    snap: Object.fromEntries(
      s.habits.map((h) => [
        h.id,
        { lv: lvOf(h).level, m: masteryOf(h).level, sp: spellLvOf(h).level, fl: fleeLvOf(h).level },
      ]),
    ),
    acted: [],
    casts: [],
    kills: [],
    payout: null,
    dmg: 0,
    dmgTaken: 0,
    kos: [],
    turns: 0,
    vices: [],
    dropped: 0,
    gameOver: false,
    fled: false,
  };
}
export function finishSession(s) {
  const ss = s.session;
  s.session = null;
  if (!ss || (!ss.acted.length && !ss.casts.length && !ss.kos.length && !ss.turns && !ss.vices.length && !ss.fled))
    return null;
  const pay = ss.payout;
  const members = s.party
    .map((id) => findHabit(s, id))
    .filter(Boolean)
    .map((h) => {
      const a = ss.snap[h.id] || { lv: 1, m: 1, sp: 1, fl: 1 };
      const g = pay && pay.gains.find((x) => x.id === h.id);
      return {
        id: h.id,
        name: h.name,
        attr: h.attr,
        xp: g ? g.xp : 0,
        lv0: a.lv,
        lv1: lvOf(h).level,
        m0: a.m,
        m1: masteryOf(h).level,
        sp0: a.sp,
        sp1: spellLvOf(h).level,
        fl0: a.fl,
        fl1: fleeLvOf(h).level,
        ko: isKO(h),
      };
    });
  return {
    turn: s.turn,
    turns: ss.turns,
    payout: pay,
    kills: ss.kills,
    dmg: ss.dmg,
    dmgTaken: ss.dmgTaken,
    kos: ss.kos,
    vices: ss.vices,
    casts: ss.casts,
    dropped: ss.dropped,
    gameOver: ss.gameOver,
    fled: ss.fled,
    title0: ss.title0,
    title1: titleOf(s),
    hero0: ss.hero0,
    hero1: heroInfo(s).level,
    members,
    enemy: { ...s.enemy },
  };
}

// The version of the state object. A change that reshapes it raises this and adds a step to
// MIGRATIONS in web/net.js, which brings older saves up to date when they are loaded.
export const GAME_VERSION = 6;

// What only this page needs: the view, open forms and pickers. Never saved.
export function freshUi(view = "camp") {
  return {
    view,
    filter: "all",
    taskSchool: null,
    adding: false,
    addingVice: false,
    swapFor: null,
    noteFor: null,
    skillsOpen: {},
    confirmReset: false,
    confirmDelete: null,
    confirmVice: null,
    formErr: "",
    picker: null,
    rankBy: "fame",
    avatarPick: "knight",
    authMode: "signin",
  };
}

// The Angel's place, before anyone stands in it. deeds and dealt are this turn's, for the bar.
export const freshAngel = () => ({ who: null, bar: 0, left: 0, arriving: false, deeds: 0, dealt: 0 });

// A new game: no companions, vices or tasks yet, some gold and a starter bag.
export function seed(character = {}) {
  const s = {
    v: GAME_VERSION,
    turn: 1,
    hero: { name: character.name || "Wanderer", avatar: character.avatar || "knight", gold: 80 },
    habits: [],
    party: [],
    nextId: 1,
    vices: [],
    nextVid: 1,
    vicePenalty: {},
    tasks: [],
    nextTid: 1,
    enemy: spawnEnemy(0),
    frontIndex: 0,
    frontSaved: null,
    seen: {},
    defeated: {},
    fame: 0,
    dragonKills: 0,
    loops: 0,
    bag: { potion: 3, ether: 1, feather: 1, eliteFeather: 0, antidote: 1, remedy: 0 },
    anthem: null,
    ward: null,
    angel: freshAngel(),
    log: [],
    openingSeen: false,
    session: null,
    lastRewards: null,
    lastTurn: null,
    ui: freshUi(),
  };
  s.seen[s.enemy.key] = true;
  addLog(s, "The party makes camp. Something small rustles in the grass.");
  return s;
}
