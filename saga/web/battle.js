import { ANGELS, ATTR, ENEMY_BY_KEY, SCHOOLS, STATUSES, TIERS } from "./data.js";
import {
  actedThisTurn,
  angelHere,
  attack,
  attackPower,
  attemptFlee,
  canAct,
  castSpell,
  endTurn,
  enemyDef,
  enemyName,
  findHabit,
  finishSession,
  hasStatus,
  isKO,
  lvOf,
  maxHpOf,
  maxMpOf,
  memberGuard,
  memberItem,
  openTasks,
  returnToFront,
  schoolOf,
  spellLvOf,
  startSession,
  travelTo,
  turnDone,
} from "./rules.js";
import { play } from "./sound.js";
import {
  ambient,
  angelSprite,
  companionSprite,
  enemySprite,
  hydrate,
  makeBg,
  paintAtFeet,
  tombSprite,
} from "./sprites.js";
import {
  RM,
  angelPlace,
  bagCount,
  closePicker,
  esc,
  go,
  hpBar,
  hpColor,
  inBattle,
  mpBar,
  pct,
  render,
  state,
  statusChips,
} from "./views.js";

/* =====================================================================
   BATTLE SCENE — canvas loop + turn choreography
   ===================================================================== */
export const BT = {
  ctx: null,
  raf: 0,
  last: 0,
  shown: null,
  flash: 0,
  shake: 0,
  dissolve: 0,
  fade: 1,
  ex: 0,
  offsets: {},
  hits: {},
  floaters: [],
  busy: false,
  allDown: false,
};
export const dur = (ms) => (RM ? Math.round(ms * 0.35) : ms);
export const ease = (t) => 1 - Math.pow(1 - t, 3);
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Animates fn(t) for t in 0..1. A timer backs up the frame loop, so a battle never stalls
// when the browser pauses animation frames (background tabs, hidden panes).
export function tween(ms, fn) {
  if (document.hidden) {
    fn(1);
    return Promise.resolve();
  }
  return new Promise((res) => {
    const t0 = performance.now();
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        fn(1);
        res();
      }
    };
    const step = (now) => {
      if (done) return;
      const t = Math.min(1, (now - t0) / ms);
      if (t >= 1) finish();
      else {
        fn(t);
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
    setTimeout(finish, ms + 80);
  });
}
// Feet positions on the 320×180 stage, by party slot. The first slot is front and centre.
export const FORMATION = [
  [206, 141],
  [258, 124],
  [206, 114],
  [258, 156],
  [206, 168],
];
export const ENEMY_FEET = [88, 158];
// The Angel's place: behind the party, off the ground. She never strikes, so she never moves from it.
export const ANGEL_FEET = [288, 92];
export const slotPos = (id) => FORMATION[Math.max(0, state.party.indexOf(id))];
export const foeTop = () => {
  const def = ENEMY_BY_KEY[BT.shown.key];
  return ENEMY_FEET[1] - enemySprite(def).gh * (def.tier <= 2 ? 2 : 3) - 6;
};

export function startScene() {
  const cv = document.getElementById("stage");
  BT.ctx = cv.getContext("2d");
  BT.ctx.imageSmoothingEnabled = false;
  BT.shown = { ...state.enemy };
  BT.flash = BT.shake = BT.dissolve = BT.ex = 0;
  BT.fade = 1;
  BT.offsets = {};
  BT.hits = {};
  BT.floaters = [];
  BT.busy = false;
  BT.allDown = false;
  cancelAnimationFrame(BT.raf);
  BT.last = performance.now();
  BT.raf = requestAnimationFrame(frame);
}
// Leaving the battle screen also clears the busy flag, so camp buttons never inherit a finished fight's lock.
export function stopScene() {
  cancelAnimationFrame(BT.raf);
  BT.raf = 0;
  BT.ctx = null;
  BT.busy = false;
}
export function frame(now) {
  if (!BT.ctx || !BT.ctx.canvas.isConnected) {
    BT.raf = 0;
    return;
  }
  const dt = Math.min(64, now - BT.last);
  BT.last = now;
  drawScene(now, dt);
  BT.raf = requestAnimationFrame(frame);
}
export function groundShadow(g, x, y, w) {
  g.fillStyle = "rgba(0,0,0,0.28)";
  g.fillRect(Math.round(x - w / 2), y - 1, Math.round(w), 3);
  g.fillRect(Math.round(x - w / 2 + 2), y + 2, Math.round(w - 4), 1);
}
export function addFloater(text, x, y, color, big) {
  BT.floaters.push({ text, x, y, color, big, t0: performance.now() });
}
export function drawScene(now, dt) {
  const g = BT.ctx,
    def = ENEMY_BY_KEY[BT.shown.key],
    bgKey = TIERS[def.tier - 1].bg;
  g.drawImage(makeBg(bgKey), 0, 0);
  ambient(g, bgKey, now);
  BT.flash = Math.max(0, BT.flash - dt / 150);
  BT.shake = Math.max(0, BT.shake - dt / 280);
  for (const id in BT.hits) BT.hits[id] = Math.max(0, BT.hits[id] - dt / 200);

  // foe
  const es = def.tier <= 2 ? 2 : 3,
    sp = enemySprite(def);
  const bob = RM ? 0 : Math.round(Math.sin(now / 420));
  const sx = BT.shake > 0 ? Math.round((Math.random() * 2 - 1) * 3 * BT.shake) : 0;
  const [efx, efy] = ENEMY_FEET;
  if (BT.dissolve < 0.95 && BT.fade > 0.5) groundShadow(g, efx + BT.ex, efy, sp.gw * es * 0.7);
  g.globalAlpha = BT.fade;
  paintAtFeet(g, sp, efx + sx + BT.ex, efy + bob, es, { white: BT.flash > 0.45, dissolve: BT.dissolve });
  g.globalAlpha = 1;

  // the Angel, while she stays, and a pip for each turn she has left
  if (angelHere(state)) {
    const [ax, ay] = ANGEL_FEET,
      who = state.angel.who;
    paintAtFeet(g, angelSprite(who), ax, ay + (RM ? 0 : Math.round(Math.sin(now / 600) * 2)), 2);
    g.fillStyle = ANGELS[who].color;
    for (let k = 0; k < state.angel.left; k++) g.fillRect(ax - 14 + k * 5, ay + 6, 3, 3);
  }

  // party, back to front
  const units = state.party.map((id, i) => ({ u: findHabit(state, id), pos: FORMATION[i] })).filter((x) => x.u);
  units.sort((a, b) => a.pos[1] - b.pos[1]);
  const warded = state.ward && state.ward.turn === state.turn;
  units.forEach(({ u, pos }, i) => {
    const [fx, fy] = pos;
    if (isKO(u) || BT.allDown) {
      paintAtFeet(g, tombSprite(), fx, fy, 2);
      return;
    }
    const o = BT.offsets[u.id] || { x: 0, y: 0 };
    const done = !canAct(state, u) && !BT.offsets[u.id];
    const b = RM || done ? 0 : Math.round(Math.sin(now / 380 + i * 1.7) * 0.8);
    groundShadow(g, fx + o.x, fy, 18);
    g.globalAlpha = done ? 0.6 : 1;
    paintAtFeet(g, companionSprite(u), fx + o.x, fy + o.y + b, 2, { white: (BT.hits[u.id] || 0) > 0.45 });
    g.globalAlpha = 1;
    // guard shield, ward ring, ailment pips, HP and MP bars
    if (u.guardTurn === state.turn) {
      g.fillStyle = "#8fdcff";
      g.fillRect(fx - 16, fy - 22, 2, 10);
      g.fillRect(fx - 17, fy - 21, 4, 8);
    }
    if (warded) {
      g.fillStyle = "rgba(143,220,255,0.35)";
      g.fillRect(fx - 13, fy - 1, 26, 2);
    }
    u.statuses.forEach((x, k) => {
      g.fillStyle = "#1b1424";
      g.fillRect(fx - 9 + k * 5, fy - 37, 5, 5);
      g.fillStyle = STATUSES[x.id].color;
      g.fillRect(fx - 8 + k * 5, fy - 36, 3, 3);
    });
    const w = 18,
      hmax = maxHpOf(u),
      mmax = maxMpOf(u);
    g.fillStyle = "#1b1424";
    g.fillRect(fx - w / 2 - 1, fy + 2, w + 2, 6);
    g.fillStyle = hpColor(u.hp, hmax);
    g.fillRect(fx - w / 2, fy + 3, Math.max(1, Math.round((w * u.hp) / hmax)), 2);
    g.fillStyle = "#4f8ad8";
    g.fillRect(fx - w / 2, fy + 5, Math.round((w * u.mp) / mmax), 2);
  });

  // damage numbers
  g.textAlign = "center";
  g.textBaseline = "top";
  BT.floaters = BT.floaters.filter((f) => now - f.t0 < 1000);
  for (const f of BT.floaters) {
    const age = (now - f.t0) / 1000;
    const y = Math.round(f.y - 22 * ease(Math.min(1, age * 1.6)));
    g.globalAlpha = 1 - Math.pow(age, 3);
    g.font = (f.big ? "12px" : "8px") + ' "Press Start 2P", monospace';
    g.fillStyle = "#1b1424";
    [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [1, 1],
    ].forEach(([dx, dy]) => g.fillText(f.text, f.x + dx, y + dy));
    g.fillStyle = f.color;
    g.fillText(f.text, f.x, y);
    g.globalAlpha = 1;
  }
}

export function setPlate(e, hp) {
  const def = enemyDef(e),
    tier = TIERS[def.tier - 1];
  const q = (id) => document.getElementById(id);
  if (!q("pl-name")) return;
  q("pl-tier").textContent = `${tier.region} · Tier ${tier.roman}`;
  q("pl-name").textContent = enemyName(e);
  q("pl-hp").textContent = `${hp} / ${e.maxHp} HP`;
  q("pl-fill").style.width = pct(hp, e.maxHp);
}
export function updateHud() {
  const gold = document.getElementById("hud-gold");
  if (gold) gold.textContent = state.hero.gold;
  const turn = document.getElementById("hud-turn");
  if (turn) turn.textContent = state.turn;
  const label = document.getElementById("turn-label");
  if (label) label.textContent = `Turn ${state.turn}`;
}
export function rowStatus(s, u) {
  if (isKO(u)) return "knocked out";
  if (hasStatus(u, "freeze")) return "frozen this turn";
  if (actedThisTurn(s, u)) return u.guardTurn === s.turn ? "guarding" : "acted this turn";
  return `ready · about ${Math.round(attackPower(u))} damage`;
}
export function updateCmd() {
  const list = document.getElementById("cmd-list");
  if (!list) return;
  const s = state;
  list.innerHTML =
    s.party
      .map((id, i) => {
        const u = findHabit(s, id),
          a = ATTR[u.attr],
          ko = isKO(u);
        const off = !canAct(s, u) || BT.busy;
        const sc = schoolOf(u),
          canSpell = openTasks(s, sc).length > 0;
        return `<div class="cmd-row ${ko ? "is-ko" : ""} ${!canAct(s, u) ? "is-off" : ""}" style="--c:${a.color}">
      <canvas class="px" data-sprite="comp:${u.id}" data-s="2"></canvas>
      <span><span class="cmd-name">${esc(u.name)}</span><span class="cmd-meta">${a.icon} ${a.cls} · LV ${lvOf(u).level} · ${rowStatus(s, u)}</span>
        <span class="cmd-bars">${hpBar(u)}<span>${u.hp}/${maxHpOf(u)}</span>${mpBar(u)}<span>${u.mp} MP</span></span>${statusChips(u)}</span>
      <span class="row-cmds">
        <button class="btn small primary" data-action="act" data-id="${id}" title="A deed done" ${off ? "disabled" : ""}>Attack${off ? "" : ` ${i + 1}`}</button>
        <button class="btn small magic" data-action="openSpells" data-user="${id}" title="${SCHOOLS[sc].name} LV ${spellLvOf(u).level}" ${off || !canSpell ? "disabled" : ""}>Spell</button>
        <button class="btn small" data-action="openItems" data-user="${id}" ${off || !bagCount(s) ? "disabled" : ""}>Item</button>
        <button class="btn small" data-action="guard" data-id="${id}" ${off ? "disabled" : ""}>Guard</button>
      </span>
    </div>`;
      })
      .join("") || '<p class="hint">No one is in the party. Add companions from the Roster.</p>';
  hydrate(list);
  const place = document.getElementById("angel-place");
  if (place) {
    place.innerHTML = angelPlace(s);
    hydrate(place);
  }
  ["flee-btn", "endturn-btn", "vice-btn"].forEach((id) => {
    const b = document.getElementById(id);
    if (b) b.disabled = BT.busy;
  });
  updateHud();
}
export function updateBattleLog() {
  const el = document.getElementById("blog");
  if (el)
    el.innerHTML = state.log
      .slice(0, 5)
      .map((l) => `<li><span class="d">T${l.turn}</span><span>${esc(l.text)}</span></li>`)
      .join("");
}
export async function showBanner(html, ms) {
  const loot = document.getElementById("loot");
  if (!loot) return;
  loot.innerHTML = html;
  loot.hidden = false;
  await wait(dur(ms));
  loot.hidden = true;
}
export async function playFoeTurn(rep) {
  if (rep.charmed) {
    await showBanner(`<b>Turn ${rep.turn}: ${esc(rep.foe)} is charmed</b>It loses its turn.`, 1200);
  } else {
    await tween(dur(200), (t) => {
      BT.ex = 30 * ease(t);
    });
    if (rep.events.length) play("hurt");
    rep.events.forEach((ev) => {
      BT.hits[ev.id] = 1;
      const p = slotPos(ev.id);
      addFloater("-" + ev.dmg, p[0], p[1] - 40, "#ff6b6b", false);
    });
    updateCmd();
    updateBattleLog();
    await tween(dur(240), (t) => {
      BT.ex = 30 * (1 - ease(t));
    });
  }
  if (rep.ticks.length) {
    await wait(dur(350));
    play("hurt");
    rep.ticks.forEach((k) => {
      const p = slotPos(k.id);
      addFloater("-" + k.dmg, p[0], p[1] - 40, "#7ccf5a", false);
    });
  }
  if (rep.regen.length) {
    await wait(dur(300));
    play("heal");
    rep.regen.forEach((r) => {
      const p = slotPos(r.id);
      addFloater(r.hp ? "+" + r.hp : "+MP", p[0], p[1] - 40, "#7cf0a0", false);
    });
    updateCmd();
  }
  if (rep.charmed) return;
  const moves =
    rep.events
      .map((e) => e.move)
      .filter((m, i, a) => a.indexOf(m) === i)
      .join(" + ") || "nothing";
  const total = rep.events.reduce((a, e) => a + e.dmg, 0) + rep.ticks.reduce((a, k) => a + k.dmg, 0);
  const kos = rep.events.filter((e) => e.ko).length + rep.ticks.filter((k) => k.ko).length;
  await showBanner(
    `<b>Turn ${rep.turn}: ${esc(rep.foe)} uses ${esc(moves)}</b>${total} damage${kos ? ` · ${kos} knocked out` : ""}`,
    1300,
  );
}
export async function finishGameOver() {
  BT.allDown = true;
  play("gameOver");
  await showBanner("<b>The party falls</b>…and wakes at camp. The foe stands whole.", 2200);
  BT.allDown = false;
  state.lastRewards = finishSession(state);
  go(state.lastRewards ? "rewards" : "camp");
}
export async function finishVictory(kill) {
  play("foeDown");
  await tween(dur(900), (t) => {
    BT.dissolve = t;
  });
  play("victory");
  await showBanner(
    `<b>Victory!</b>${esc(enemyName(kill.killed))} defeated · +${kill.pay.xp} XP · +${kill.pay.gold} gold`,
    1600,
  );
  const r = (state.lastRewards = finishSession(state));
  go("rewards");
  if (r && grewUp(r)) play("levelUp", 150);
}
// Whether the battle report shows anything going up: a companion's level or skills, the hero, a title.
const grewUp = (r) =>
  r.hero1 > r.hero0 ||
  r.title1 !== r.title0 ||
  r.members.some((c) => c.lv1 > c.lv0 || c.m1 > c.m0 || c.sp1 > c.sp0 || c.fl1 > c.fl0);
// The Angel's arrival: her painting fills the screen, until a click or a short wait. The flag lives in
// the saved game, so a reload or a victory on that turn only puts it off to the next chance.
export async function angelArrives() {
  const a = state.angel;
  if (!a.arriving) return;
  a.arriving = false;
  const def = ANGELS[a.who];
  updateBattleLog();
  if (document.hidden) return;
  play("angel");
  const el = document.createElement("div");
  el.className = "angel-arrival";
  el.style.setProperty("--c", def.color);
  el.innerHTML = `<img src="${def.painting}" alt="${def.name}"><p>${esc(def.arrives)}</p>`;
  document.body.append(el);
  await new Promise((done) => {
    el.addEventListener("click", done, { once: true });
    setTimeout(done, dur(3400));
  });
  el.remove();
}
// Runs the foe's turn (animated) and handles Game Over. Returns true if the battle ended.
export async function runFoeTurn() {
  BT.busy = true;
  updateCmd();
  await wait(dur(250));
  const rep = endTurn(state);
  await playFoeTurn(rep);
  if (rep.gameOver) {
    await finishGameOver();
    return true;
  }
  await angelArrives();
  BT.busy = false;
  updateCmd();
  updateBattleLog();
  return false;
}
// Keeps the battle rolling: whenever no one can act (all acted, frozen or down), the foe takes its turn,
// again and again if needed, until someone can act or the party falls.
export async function afterAction() {
  let guard = 0;
  while (inBattle() && turnDone(state) && guard++ < 20) {
    if (await runFoeTurn()) return;
  }
  BT.busy = false;
  updateCmd();
  updateBattleLog();
}
// Shared ending for any action: burn, counters, victory or Game Over, then let the turn roll.
export async function resolveOutcome(id, res) {
  if (res.burn) {
    const p = slotPos(id);
    BT.hits[id] = 1;
    play("hurt");
    addFloater("-" + res.burn, p[0], p[1] - 40, "#f08a3a", false);
    await wait(dur(300));
  }
  if (res.counter && res.counter.length) {
    await tween(dur(160), (t) => {
      BT.ex = 24 * ease(t);
    });
    play("hurt");
    res.counter.forEach((ev) => {
      BT.hits[ev.id] = 1;
      const p = slotPos(ev.id);
      addFloater("-" + ev.dmg, p[0], p[1] - 40, "#ff6b6b", false);
    });
    updateCmd();
    updateBattleLog();
    await tween(dur(220), (t) => {
      BT.ex = 24 * (1 - ease(t));
    });
    await wait(dur(380));
  }
  if (res.echo) {
    await lunge(id);
    play("hit");
    BT.flash = 1;
    addFloater(String(res.echo.dmg), ENEMY_FEET[0], foeTop(), ANGELS.lunaria.color, false);
    setPlate(BT.shown, res.echo.hpAfter);
    updateBattleLog();
    await wait(dur(120));
    await retreat(id);
  }
  if (res.kill) {
    if (res.gameOver) {
      await finishGameOver();
      return;
    }
    await finishVictory(res.kill);
    return;
  }
  if (res.gameOver) {
    await finishGameOver();
    return;
  }
  await afterAction();
}
export async function lunge(id, reach = -40) {
  await tween(dur(230), (t) => {
    BT.offsets[id] = { x: reach * ease(t), y: -Math.round(7 * Math.sin(Math.PI * t)) };
  });
}
export async function retreat(id, reach = -40) {
  await tween(dur(230), (t) => {
    BT.offsets[id] = { x: reach * (1 - ease(t)), y: 0 };
  });
  delete BT.offsets[id];
}
export async function doAct(id) {
  if (BT.busy || !BT.ctx || state.ui.picker) return;
  const res = attack(state, id);
  if (!res) return;
  BT.busy = true;
  updateCmd();
  await lunge(id);
  if (res.miss) {
    play("miss");
    addFloater("MISS", ENEMY_FEET[0], foeTop(), "#b8b2c8", false);
  } else {
    play(res.crit ? "crit" : "hit");
    BT.flash = 1;
    BT.shake = 1;
    addFloater(
      (res.crit ? "CRIT " : "") + res.dmg,
      ENEMY_FEET[0],
      foeTop(),
      res.crit ? "#ffd23f" : "#ffffff",
      res.crit,
    );
  }
  if (res.masteryUp) {
    play("levelUp", 120);
    const p = slotPos(id);
    addFloater("MASTERY UP", p[0], p[1] - 48, "#ffd23f", false);
  }
  setPlate(BT.shown, res.hpAfter);
  updateBattleLog();
  await wait(dur(170));
  await retreat(id);
  await resolveOutcome(id, res);
}
export async function doCast(id, taskId) {
  closePicker();
  if (BT.busy) return;
  const res = castSpell(state, id, taskId);
  if (!res) return;
  BT.busy = true;
  updateCmd();
  const p = slotPos(id);
  play("spell");
  addFloater(SCHOOLS[res.school].name.toUpperCase(), p[0], p[1] - 48, "#8fb8ff", false);
  if (res.school === "force" || res.school === "finish") {
    await lunge(id, -30);
    play("hit");
    BT.flash = 1;
    BT.shake = 1;
    addFloater(String(res.dmg), ENEMY_FEET[0], foeTop(), "#c8dcff", true);
    setPlate(BT.shown, res.hpAfter);
    await wait(dur(170));
    await retreat(id, -30);
  } else {
    await wait(dur(300));
    res.effects.forEach((ef) => {
      if (ef.foe) addFloater(ef.text, ENEMY_FEET[0], foeTop(), ef.text === "RESISTED" ? "#b8b2c8" : "#c08ae8", false);
      else {
        const q = slotPos(ef.id);
        addFloater(ef.text, q[0], q[1] - 40, "#7cf0a0", false);
      }
    });
    await wait(dur(500));
  }
  if (res.levelUp) {
    play("levelUp");
    addFloater(`${SCHOOLS[res.school].name.toUpperCase()} LV ${res.level + 1}`, p[0], p[1] - 56, "#ffd23f", false);
  }
  updateBattleLog();
  updateCmd();
  await resolveOutcome(id, res);
}
export async function doMemberItem(userId, key, id) {
  const r = memberItem(state, userId, key, id);
  closePicker();
  if (!r) return;
  BT.busy = true;
  updateCmd();
  const p = slotPos(id);
  play("heal");
  addFloater(
    key === "potion" ? "+HP" : key === "ether" ? "+MP" : key === "antidote" || key === "remedy" ? "CURED" : "RISE",
    p[0],
    p[1] - 40,
    "#7cf0a0",
    false,
  );
  updateBattleLog();
  await wait(dur(500));
  await resolveOutcome(userId, r);
}
export async function doGuard(id) {
  if (BT.busy) return;
  const r = memberGuard(state, id);
  if (!r) return;
  BT.busy = true;
  play("guard");
  updateCmd();
  updateBattleLog();
  await wait(dur(300));
  await resolveOutcome(id, r);
}
// Travel happens from camp only; in battle the way out is fleeing.
export function doTravel(to) {
  closePicker();
  if (to === "front") returnToFront(state);
  else travelTo(state, +to);
  render();
}
export async function doEndTurn() {
  if (BT.busy || !state.party.length) return;
  if (!(await runFoeTurn())) await afterAction();
}
export async function doFlee() {
  if (BT.busy || state.ui.picker) return;
  BT.busy = true;
  updateCmd();
  const r = attemptFlee(state);
  if (r.ok) {
    play("flee");
    await tween(dur(450), (t) => {
      for (const id of state.party) BT.offsets[id] = { x: 70 * ease(t), y: 0 };
    });
    if (r.gameOver) {
      await finishGameOver();
      return;
    }
    await showBanner("<b>Got away!</b>The foe keeps its wounds.", 1200);
    BT.offsets = {};
    state.lastRewards = finishSession(state);
    go(state.lastRewards ? "rewards" : "camp");
    return;
  }
  play("fleeFail");
  if (r.dropped) play("coins", 320);
  await tween(dur(200), (t) => {
    for (const id of state.party) BT.offsets[id] = { x: 14 * Math.sin(Math.PI * t), y: 0 };
  });
  BT.offsets = {};
  updateCmd();
  updateBattleLog();
  await showBanner(
    `<b>Couldn't escape!</b>The party loses its turn.${r.dropped ? `<br>${r.dropped} gold scattered.` : ""}`,
    1400,
  );
  await afterAction();
}
// Entering a battle where no one can act (everyone frozen, say) lets the foe roll straight on.
export function startBattle() {
  startSession(state);
  state.anthem = null;
  state.ward = null;
  go("battle");
  if (state.angel.arriving || turnDone(state)) {
    BT.busy = true;
    updateCmd();
    wait(dur(600)).then(angelArrives).then(afterAction);
  }
}
