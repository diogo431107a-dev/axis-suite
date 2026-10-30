import { BT, startScene, stopScene, updateBattleLog, updateCmd } from "./battle.js";
import { ANGELS, ATTR, ATTRS, AVATARS, ENEMIES, ENEMY_BY_KEY, ITEMS, SCHOOLS, STATUSES, TIERS, TUNE } from "./data.js";
import {
  actedThisTurn,
  atFront,
  canAct,
  canUse,
  enemyDef,
  enemyName,
  findHabit,
  fleeLvOf,
  frontPreview,
  hasStatus,
  heroInfo,
  innCost,
  innNeeded,
  isKO,
  lvOf,
  masteryOf,
  maxHpOf,
  maxMpOf,
  openTasks,
  fameTitle,
  partyUnits,
  pointsOf,
  regionReached,
  schoolOf,
  sheetAttr,
  spawnEnemy,
  spellCost,
  spellLvOf,
  titleOf,
  titleVoice,
  travelOptions,
  viceNow,
  vicePreview,
} from "./rules.js";
import { volume } from "./sound.js";
import { account, fetchRanking, refreshRank } from "./net.js";
import { SH, SW, hydrate } from "./sprites.js";

/* =====================================================================
   VIEWS
   ===================================================================== */
export let state;
export function setState(s) {
  state = s;
}
export const app = document.getElementById("app");
export const modal = document.getElementById("modal");
export const RM = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const pct = (a, b) => Math.max(0, Math.min(100, (a / b) * 100)).toFixed(1) + "%";
export const bar = (p, color, cls = "") =>
  `<div class="bar ${cls}" ${color ? `style="--c:${color}"` : ""}><i style="width:${p}"></i></div>`;
export const hpColor = (hp, max) => (hp / max > 0.5 ? "#5fbf6a" : hp / max > 0.25 ? "#e9b949" : "#d9534f");
export const hpBar = (u, cls = "thin") => bar(pct(u.hp, maxHpOf(u)), hpColor(u.hp, maxHpOf(u)), cls);
export const mpBar = (u, cls = "thin") => bar(pct(u.mp, maxMpOf(u)), "var(--mp)", cls);
export const coin = '<span class="coin" aria-hidden="true"></span>';
export const signed = (n) => (n < 0 ? "−" : "+") + Math.abs(n);
export const inBattle = () => state.ui.view === "battle";
export const busyInBattle = () => inBattle() && BT.busy;
export const schoolLabel = (sc) => {
  const a = ATTR[SCHOOLS[sc].attr];
  return `${a.icon} ${SCHOOLS[sc].name}`;
};
export const statusChips = (u) =>
  u.statuses.length
    ? `<span class="sts">${u.statuses.map((x) => `<span class="st" style="--sc:${STATUSES[x.id].color}" title="${STATUSES[x.id].text}">${STATUSES[x.id].name.toUpperCase()}${x.left != null ? " " + x.left : ""}</span>`).join("")}</span>`
    : "";
export const bagCount = (s) => Object.values(s.bag).reduce((a, b) => a + b, 0);

export function header() {
  const tabs = [
    ["camp", "Camp"],
    ["roster", "Roster"],
    ["spellbook", "Spellbook"],
    ["shop", "Shop"],
    ["bestiary", "Bestiary"],
    ["fame", "Hall of Fame"],
    ["account", "Account"],
  ];
  return `<header class="top">
    <button class="logo" data-action="about" title="About Habits Saga">HABITS<br>SAGA</button>
    ${
      inBattle()
        ? ""
        : `<nav class="tabs" aria-label="Sections">${tabs
            .map(
              ([v, l]) =>
                `<button class="tab" data-action="nav" data-view="${v}" ${state.ui.view === v ? 'aria-current="page"' : ""}>${l}</button>`,
            )
            .join("")}</nav>`
    }
    <div class="hud">
      <button class="btn small" data-action="help" title="Help" aria-label="Help">?</button>
      <span class="chip warn" id="hud-save" title="Your progress is kept on this page and sent again every second" ${account.saveFailing ? "" : "hidden"}>Not saved · retrying</span>
      <span class="chip">Turn <span class="num" id="hud-turn">${state.turn}</span></span>
      <span class="chip" title="Gold">${coin}<span class="num" id="hud-gold">${state.hero.gold}</span></span>
    </div>
  </header>`;
}
// The top bar for visitors who aren't signed in, looking at the Hall of Fame.
export function guestHeader() {
  return `<header class="top">
    <button class="logo" data-action="about" title="About Habits Saga">HABITS<br>SAGA</button>
    <div class="hud"><button class="btn small" data-action="help" title="Help" aria-label="Help">?</button><button class="btn small primary" data-action="nav" data-view="welcome">Sign in or join</button></div>
  </header>`;
}
// A message from the server side (another device saved, signed out…), dismissed with ×.
export function noticeBar() {
  if (!account.notice) return "";
  return `<p class="notice" role="status"><span>${esc(account.notice)}</span><button class="linkish" data-action="dismissNotice" aria-label="Dismiss">×</button></p>`;
}

export function memberSlot(s, id) {
  const u = findHabit(s, id),
    ko = isKO(u),
    a = ATTR[u.attr];
  const st = ko
    ? ["ko", "KNOCKED OUT"]
    : hasStatus(u, "freeze")
      ? ["done", "FROZEN"]
      : actedThisTurn(s, u)
        ? ["done", "ACTED"]
        : ["ready", "READY"];
  return `<div class="slot ${ko ? "is-ko" : ""}" style="--c:${a.color}">
    <canvas class="px" data-sprite="comp:${u.id}" data-s="3"></canvas>
    <div class="s-name">${esc(u.name)}</div>
    <div class="s-meta">${a.icon} LV ${lvOf(u).level}</div>
    ${hpBar(u)}
    ${mpBar(u)}
    <div class="s-hp">${u.hp}/${maxHpOf(u)} HP · ${u.mp} MP</div>
    ${statusChips(u)}
    <span class="state ${st[0]}">${st[1]}</span>
  </div>`;
}

export function turnCard(s) {
  const t = s.lastTurn;
  if (!t || t.dismissed) return "";
  const rows = t.events.map(
    (e) =>
      `<li><b>${esc(e.name)}</b> took ${e.dmg} from ${esc(e.move)}${e.hits > 1 ? ` ×${e.hits}` : ""}${e.guarded ? " (guarded)" : ""}${e.ko ? ` and was <b class="ko-t">knocked out</b>${e.loss ? `, losing ${e.loss} XP` : ""}` : ""}.</li>`,
  );
  t.ticks.forEach((k) =>
    rows.push(
      `<li><b>${esc(k.name)}</b> lost ${k.dmg} HP to poison${k.ko ? ' and was <b class="ko-t">knocked out</b>' : ""}.</li>`,
    ),
  );
  if (t.charmed) rows.unshift("<li>The foe was charmed and lost its turn.</li>");
  if (!rows.length) rows.push("<li>No one in the party could be reached.</li>");
  if (t.gameOver)
    rows.push("<li><b>The party fell.</b> It woke at camp with 1 HP each, and the foe stands whole.</li>");
  return `<section class="win report" aria-label="Last turn">
    <h2 class="sect">Last turn <span>Turn ${t.turn}</span></h2>
    <p>${esc(t.foe)} answered the party's turn.</p>
    <ul class="report-list">${rows.join("")}</ul>
    <button class="btn small" data-action="dismissTurn">Got it</button>
  </section>`;
}

export function heroSheet(s) {
  const hi = heroInfo(s);
  const vals = ATTRS.map((a) => sheetAttr(s, a.id));
  const top = Math.max(1, ...vals);
  return `<section class="win" aria-label="Hero">
    <div class="hero-head">
      <canvas class="px" data-sprite="hero" data-s="6"></canvas>
      <div class="hero-meta">
        <div class="eyebrow">The hero</div>
        <h1 class="hero-name">${esc(s.hero.name)}</h1>
        <div class="hero-title"><span class="voice">${titleVoice(s)}</span> ${esc(titleOf(s))}</div>
        <div class="hero-lv"><span>Level <b>${hi.level}</b></span><span class="num">${hi.into} / ${hi.need} pts</span></div>
        ${bar(pct(hi.into, hi.need), "var(--accent)")}
        <div class="hero-lv"><span>${hi.total} attribute points</span><span>Fame <b>${s.fame}</b></span></div>
        <div class="hero-lv"><span>Hall of Fame</span><button class="linkish" data-action="nav" data-view="fame">${account.rank ? `Rank #${account.rank} by fame` : s.habits.length ? "See the ranking" : "Add a habit to be ranked"}</button></div>
      </div>
    </div>
    <h2 class="sect">Attributes</h2>
    <ul class="attrs">
      ${ATTRS.map((a, i) => {
        const pen = s.vicePenalty[a.id] || 0;
        return `<li class="attr">
        <span class="ico" aria-hidden="true">${a.icon}</span>
        <span class="nm" style="color:${a.color}">${a.name}</span>
        <span class="lv">${vals[i]}${pen ? ` <span class="pen">(−${pen})</span>` : ""}</span>
        ${bar(pct(vals[i], top), a.color, "thin")}
      </li>`;
      }).join("")}
    </ul>
  </section>`;
}

// The Angel's place: a bar with no numbers, or who stands there now.
export function angelPlace(s) {
  const a = s.angel;
  if (!a.who)
    return `<div class="angel-place"><span>The Angel's place stands empty.</span><button class="btn small" data-action="openAngel">Choose</button></div>`;
  const def = ANGELS[a.who];
  if (a.left)
    return `<div class="angel-place is-here" style="--c:${def.color}"><canvas class="px" data-sprite="angel:${a.who}" data-s="1"></canvas><span>${def.name} stands with you.</span></div>`;
  return `<div class="angel-place" style="--c:${def.color}"><span>The Angel's place</span>${bar(pct(a.bar, TUNE.angel.bar), def.color, "thin")}</div>`;
}

export function campView() {
  const s = state,
    e = s.enemy,
    def = enemyDef(e),
    tier = TIERS[def.tier - 1];
  const members = partyUnits(s);
  const ready = members.filter((u) => canAct(s, u)).length;
  const allDown = members.length && members.every(isKO);
  const slots = [];
  for (let i = 0; i < TUNE.partySize; i++) {
    const id = s.party[i];
    slots.push(id ? memberSlot(s, id) : `<div class="slot empty">Empty slot</div>`);
  }
  const readyText = !s.habits.length
    ? "No one has answered yet. Keep a habit, and someone will."
    : !members.length
      ? "The party is empty. Add companions from the Roster."
      : allDown
        ? "All have fallen. Only a Phoenix Feather raises them."
        : ready === members.length
          ? `All ${members.length} companions are ready.`
          : ready
            ? `${ready} of ${members.length} still to act this turn.`
            : "Everyone has acted. The foe answers when you return to battle.";
  const front = atFront(s)
    ? ""
    : (() => {
        const f = frontPreview(s);
        return `<p class="front-note">You travelled back. ${esc(enemyName(f))} waits at the front with ${f.hp} / ${f.maxHp} HP.</p>`;
      })();
  const cost = innCost(s);
  return `<main class="camp">
    <div class="camp-col">${heroSheet(s)}</div>
    <div class="camp-col">
      ${turnCard(s)}
      <section class="win" aria-label="Current foe">
        <h2 class="sect">Current foe <span>${esc(tier.region)} · Tier ${tier.roman}</span></h2>
        <div class="foe">
          <div class="foe-art"><canvas class="px" data-sprite="enemy:${def.key}" data-s="${def.tier <= 2 ? 5 : 4}"></canvas></div>
          <div class="foe-info">
            <div class="foe-name">${esc(enemyName(e))}</div>
            <p class="lore">${esc(def.lore)}</p>
            ${front}
            ${bar(pct(e.hp, e.maxHp), null, "hp")}
            <div class="hp-row"><span>${e.hp < e.maxHp ? "Wounded" : "Unhurt"}</span><span class="num" style="font-size:9px">${e.hp} / ${e.maxHp} HP</span></div>
            <div class="fight-row">
              ${
                s.habits.length
                  ? `<button class="btn primary" data-action="fight" ${members.length && !allDown ? "" : "disabled"}>Fight</button>`
                  : '<button class="btn primary" data-action="firstHabit">Call your first companion</button>'
              }
              <button class="btn small" data-action="openTravel">Travel</button>
            </div>
            <span class="ready-note">${readyText}</span>
          </div>
        </div>
      </section>
      <section class="win" aria-label="Party">
        <h2 class="sect">Party <span class="num">${s.party.length} / ${TUNE.partySize}</span></h2>
        <div class="party-slots">${slots.join("")}</div>
        ${angelPlace(s)}
        <div class="party-foot">
          <span>Bag: ${bagCount(s)} item${bagCount(s) === 1 ? "" : "s"} · ${openTasks(s).length} open tasks</span>
          <span class="acts">
            <button class="btn small vice" data-action="openVices">Pay the tithe</button>
            <button class="btn small" data-action="openItems" ${bagCount(s) ? "" : "disabled"}>Use item</button>
            <button class="btn small" data-action="nav" data-view="roster">Roster</button>
          </span>
        </div>
      </section>
      <section class="win" aria-label="Inn">
        <h2 class="sect">Inn <span>${coin} ${cost}</span></h2>
        <div class="inn-row">
          <p class="inn-text">A bed, a fire, no questions. The dead stay dead.</p>
          <button class="btn small primary" data-action="inn" ${s.hero.gold >= cost && innNeeded(s) ? "" : "disabled"}>Rest</button>
        </div>
      </section>
      <section class="win" aria-label="Chronicle">
        <h2 class="sect">Chronicle</h2>
        <ol class="log">${s.log
          .slice(0, 6)
          .map((l) => `<li><span class="d">T${l.turn}</span><span>${esc(l.text)}</span></li>`)
          .join("")}</ol>
      </section>
    </div>
  </main>`;
}

export function swapBox(s, id) {
  if (s.ui.swapFor !== id) return "";
  return `<div class="swap">
    <p>The party is full. Who should step out?</p>
    <div class="swap-list">${s.party.map((pid) => `<button class="btn small" data-action="swap" data-out="${pid}">${esc(findHabit(s, pid).name)}</button>`).join("")}
    <button class="btn small" data-action="cancelSwap">Cancel</button></div>
  </div>`;
}
export function rangeField(obj, key, label, min, max, step) {
  const id = `${key}-${obj.id}`;
  return `<div class="slider">
    <label for="${id}">${label} <output id="${id}-v">${obj[key]}</output></label>
    <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${obj[key]}" data-field="${key}" data-id="${obj.id}" data-out="${id}-v">
  </div>`;
}
export function statusNote(s, u) {
  const inParty = s.party.includes(u.id);
  if (isKO(u)) return inParty ? "Knocked out in the party" : "Knocked out on the bench";
  if (!inParty) return "On the bench";
  return actedThisTurn(s, u) ? "In party · acted this turn" : "In party · ready";
}
export function compCard(h) {
  const s = state,
    a = ATTR[h.attr],
    l = lvOf(h),
    m = masteryOf(h),
    sp = spellLvOf(h),
    fl = fleeLvOf(h);
  const inParty = s.party.includes(h.id);
  return `<article class="win comp ${inParty ? "in-party" : ""} ${isKO(h) ? "is-ko" : ""}" style="--c:${a.color}">
    <div class="comp-top">
      <canvas class="px" data-sprite="comp:${h.id}" data-s="3"></canvas>
      <div class="comp-id">
        <h3 class="comp-name">${esc(h.name)}</h3>
        <div class="comp-meta"><span class="attr-chip">${a.icon} +${pointsOf(h)} ${a.name}</span><span>${a.cls}</span></div>
        <div class="lvline"><span>LV ${l.level}</span>${bar(pct(l.into, l.need), a.color, "thin")}<span>${l.into}/${l.need}</span></div>
        <div class="lvline"><span>HP</span>${hpBar(h)}<span>${h.hp}/${maxHpOf(h)}</span></div>
        <div class="lvline"><span>MP</span>${mpBar(h)}<span>${h.mp}/${maxMpOf(h)}</span></div>
        ${statusChips(h)}
      </div>
    </div>
    ${h.note && s.ui.noteFor !== h.id ? `<p class="comp-note">${esc(h.note)}</p>` : ""}
    ${s.ui.noteFor === h.id ? noteForm(h) : ""}
    ${
      s.ui.skillsOpen[h.id]
        ? `<div class="skills">
      <div class="skill"><span class="k">Mastery</span><span class="v">LV ${m.level}</span><span class="n">${h.checkins} check-ins</span></div>
      <div class="skill"><span class="k">${SCHOOLS[a.school].name}</span><span class="v">LV ${sp.level}</span><span class="n">${h.casts} casts</span></div>
      <div class="skill"><span class="k">Flee</span><span class="v">LV ${fl.level}</span><span class="n">${h.escapes} escape${h.escapes === 1 ? "" : "s"} led</span></div>
    </div>`
        : ""
    }
    <div class="comp-foot"><span class="foot-note">${statusNote(s, h)}</span><button class="btn small" data-action="editNote" data-id="${h.id}">Note</button><button class="btn small" data-action="toggleSkills" data-id="${h.id}" aria-expanded="${!!s.ui.skillsOpen[h.id]}">Skills</button>${
      inParty
        ? `<button class="btn small" data-action="bench" data-id="${h.id}">Bench</button>`
        : `<button class="btn small primary" data-action="join" data-id="${h.id}">Join party</button>`
    }<button class="btn small danger" data-action="askDelete" data-kind="habit" data-id="${h.id}">Delete</button></div>
    ${swapBox(s, h.id)}
    ${confirmBox(
      s,
      "habit",
      h.id,
      `Delete ${esc(h.name)} for good? Its level, skills and XP are lost, and its +${pointsOf(h)} ${a.name} leaves the hero's sheet, so the hero's level may drop.`,
    )}
  </article>`;
}
export function noteForm(h) {
  return `<form id="note-form" class="note-form" data-id="${h.id}">
    <textarea class="text-in" name="note" rows="3" maxlength="${TUNE.noteMax}" aria-label="Note on ${esc(h.name)}" placeholder="Why this habit? What counts as doing it? What is the goal now?">${esc(h.note)}</textarea>
    <div class="swap-list"><button type="submit" class="btn small primary">Save</button>
    <button type="button" class="btn small" data-action="cancelNote">Cancel</button></div>
  </form>`;
}
export function viceCard(v) {
  const a = ATTR[v.attr],
    now = viceNow(v);
  return `<article class="win comp vice-card" style="--c:${a.color}">
    <div class="comp-id">
      <h3 class="comp-name">${esc(v.name)}</h3>
      <div class="comp-meta"><span class="attr-chip">${a.icon} drains ${a.name}</span><span>paid ${v.count}×</span></div>
      <p class="foot-note">Next tithe: −${now.drain} ${a.name} and −${now.cost} gold.</p>
    </div>
    ${rangeField(v, "drain", `${a.name} points taken`, 1, 10, 1)}
    ${rangeField(v, "cost", "Gold it costs", 0, 50, 1)}
    <div class="comp-foot"><span class="acts"><button class="btn small danger" data-action="askDelete" data-kind="vice" data-id="${v.id}">Delete</button><button class="btn small vice" data-action="logVice" data-id="${v.id}">Pay the tithe</button></span></div>
    ${viceConfirm(state, v)}
    ${confirmBox(state, "vice", v.id, `Stop tracking ${esc(v.name)}? The points it already took stay taken.`)}
  </article>`;
}
// Asks before deleting a companion or a vice (state.ui.confirmDelete).
export function confirmBox(s, kind, id, text) {
  const c = s.ui.confirmDelete;
  if (!c || c.kind !== kind || c.id !== id) return "";
  return `<div class="swap confirm">
    <p>${text}</p>
    <div class="swap-list"><button class="btn small danger" data-action="confirmDelete">Delete</button>
    <button class="btn small" data-action="cancelConfirm">Keep</button></div>
  </div>`;
}
// Asks before logging a vice (state.ui.confirmVice), saying what it will cost right now.
export function viceConfirm(s, v) {
  if (s.ui.confirmVice !== v.id) return "";
  const a = ATTR[v.attr],
    p = vicePreview(s, v);
  const points = p.drain
    ? `It takes ${p.drain} ${a.name} from the hero${p.cost && p.canPay ? ` and costs ${p.cost} gold` : ""}.`
    : `The hero has no ${a.name} left for it to take.${p.cost && p.canPay ? ` It costs ${p.cost} gold.` : ""}`;
  const purse =
    p.cost && !p.canPay ? ` The purse can't pay its ${p.cost} gold, so an ailment will strike the party instead.` : "";
  return `<div class="swap confirm vice">
    <p>Pay the tithe for ${esc(v.name)}? ${points}${purse}</p>
    <div class="swap-list"><button class="btn small vice" data-action="confirmVice">Pay</button>
    <button class="btn small" data-action="cancelConfirm">Cancel</button></div>
  </div>`;
}

// Starts on the attribute the Roster is filtered to, or the first one.
export function attrPicker(prefix, withClass) {
  const pick = ATTR[state.ui.filter] ? state.ui.filter : ATTRS[0].id;
  return `<div class="attr-pick">${ATTRS.map((a) => `<label style="--c:${a.color}"><input type="radio" name="attr" id="${prefix}-attr-${a.id}" value="${a.id}" ${a.id === pick ? "checked" : ""}><span>${a.icon} ${a.name}${withClass ? " · " + a.cls : ""}</span></label>`).join("")}</div>`;
}
export function formErr() {
  return state.ui.formErr ? `<span class="form-err">${esc(state.ui.formErr)}</span>` : "";
}
export function addForm() {
  return `<section class="win">
    <h2 class="sect">New companion</h2>
    <form id="add-form" class="add-form" autocomplete="off">
      <div class="field full">
        <label for="f-name">Habit</label>
        <input class="text-in" id="f-name" name="name" maxlength="40" placeholder="e.g. Stretch before bed">
      </div>
      <fieldset class="field full" style="border:0;padding:0;margin:0">
        <span>What it trains <button type="button" class="linkish" data-action="help">What do these mean?</button></span>
        ${attrPicker("f", true)}
      </fieldset>
      <div class="form-actions full">
        ${formErr()}
        <button type="button" class="btn small" data-action="toggleAdd">Cancel</button>
        <button type="submit" class="btn primary">Call them</button>
      </div>
    </form>
  </section>`;
}
export function addViceForm() {
  const D = TUNE.vice;
  return `<section class="win">
    <h2 class="sect">Name a vice</h2>
    <form id="vice-form" class="add-form" autocomplete="off">
      <div class="field">
        <label for="vf-name">Bad habit</label>
        <input class="text-in" id="vf-name" name="name" maxlength="40" placeholder="e.g. Late-night snacking">
      </div>
      <div class="field">
        <span>Each time it is paid</span>
        <div class="slider"><label for="vf-drain">Points taken <output id="vf-drain-v">${D.drain}</output></label>
          <input type="range" id="vf-drain" name="drain" min="1" max="10" step="1" value="${D.drain}" data-out="vf-drain-v"></div>
        <div class="slider"><label for="vf-cost">Gold it costs <output id="vf-cost-v">${D.cost}</output></label>
          <input type="range" id="vf-cost" name="cost" min="0" max="50" step="1" value="${D.cost}" data-out="vf-cost-v"></div>
      </div>
      <fieldset class="field full" style="border:0;padding:0;margin:0">
        <span>Attribute it drains</span>
        ${attrPicker("vf", false)}
      </fieldset>
      <div class="form-actions full">
        ${formErr()}
        <button type="button" class="btn small" data-action="toggleAddVice">Cancel</button>
        <button type="submit" class="btn primary">Name it</button>
      </div>
    </form>
  </section>`;
}

export function rosterView() {
  const s = state,
    f = s.ui.filter;
  // party first, then the bench; each by level (highest first), then most recently used
  const list = s.habits
    .filter((h) => f === "all" || h.attr === f)
    .sort(
      (a, b) =>
        s.party.includes(b.id) - s.party.includes(a.id) ||
        lvOf(b).level - lvOf(a).level ||
        b.lastActedTurn - a.lastActedTurn,
    );
  const vices = s.vices.filter((v) => f === "all" || v.attr === f);
  return `<main style="display:flex;flex-direction:column;gap:16px">
    <div class="page-head">
      <div>
        <h1 class="page-title">Roster</h1>
        <p class="page-sub">Those who answered.</p>
      </div>
      ${s.ui.adding ? "" : '<button class="btn primary" data-action="toggleAdd">Call a companion</button>'}
    </div>
    ${s.ui.adding ? addForm() : ""}
    <div class="filters" role="group" aria-label="Filter by attribute">
      <button class="fchip" data-action="filter" data-attr="all" aria-pressed="${f === "all"}">All · ${s.habits.length}</button>
      ${ATTRS.map((a) => `<button class="fchip" style="--c:${a.color}" data-action="filter" data-attr="${a.id}" aria-pressed="${f === a.id}">${a.name} · ${s.habits.filter((h) => h.attr === a.id).length}</button>`).join("")}
    </div>
    <div class="cards">${list.map(compCard).join("") || '<p class="page-sub">No companions train this attribute yet.</p>'}</div>
    <div class="page-head" style="margin-top:12px">
      <div>
        <h2 class="section-title">Vices</h2>
        <p class="page-sub">The Dragon keeps accounts.</p>
      </div>
      ${s.ui.addingVice ? "" : '<button class="btn vice" data-action="toggleAddVice">Name a vice</button>'}
    </div>
    ${s.ui.addingVice ? addViceForm() : ""}
    <div class="cards">${vices.map(viceCard).join("") || '<p class="page-sub">No vice has been named here.</p>'}</div>
  </main>`;
}

export function spellbookView() {
  const s = state;
  const done = s.tasks
    .filter((t) => t.done)
    .sort((a, b) => b.doneTurn - a.doneTurn)
    .slice(0, 15);
  const casters = (sc) => s.habits.filter((h) => schoolOf(h) === sc);
  // Stays on the school last picked. Until one is picked, it follows the Roster's filter.
  const school = s.ui.taskSchool || (ATTR[s.ui.filter] ? ATTR[s.ui.filter].school : ATTRS[0].school);
  return `<main style="display:flex;flex-direction:column;gap:18px">
    <div class="page-head">
      <div>
        <h1 class="page-title">Spellbook</h1>
        <p class="page-sub">Deeds done once, burned up in the casting.</p>
      </div>
    </div>
    <section class="win">
      <h2 class="sect">New task</h2>
      <form id="task-form" class="add-form" autocomplete="off">
        <div class="field full">
          <label for="tf-name">Task</label>
          <input class="text-in" id="tf-name" name="name" maxlength="50" placeholder="e.g. Call the plumber">
        </div>
        <fieldset class="field full" style="border:0;padding:0;margin:0">
          <span>School</span>
          <div class="attr-pick">${ATTRS.map((a) => `<label style="--c:${a.color}"><input type="radio" name="school" id="tf-${a.school}" value="${a.school}" ${a.school === school ? "checked" : ""}><span>${a.icon} ${SCHOOLS[a.school].name} · ${a.cls}</span></label>`).join("")}</div>
        </fieldset>
        <div class="form-actions full">${formErr()}<button type="submit" class="btn primary">Add task</button></div>
      </form>
    </section>
    ${ATTRS.map((a) => {
      const tasks = openTasks(s, a.school);
      const who = casters(a.school);
      return `<section class="school-block" style="--c:${a.color}">
        <div class="school-head"><h2>${a.icon} ${SCHOOLS[a.school].name}</h2><span class="tier-tag">${a.cls}s · ${who.length ? who.map((h) => `${esc(h.name)} LV ${spellLvOf(h).level}`).join(", ") : "no companion of this class yet"}</span></div>
        <p class="task-meta">${esc(SCHOOLS[a.school].lore)}</p>
        <div class="tasks">${
          tasks
            .map(
              (t) => `<div class="task" style="--c:${a.color}">
          <span class="task-name">${esc(t.name)}</span>
          <button class="btn small" data-action="removeTask" data-id="${t.id}">Remove</button>
        </div>`,
            )
            .join("") || '<p class="task-meta">No open tasks.</p>'
        }</div>
      </section>`;
    }).join("")}
    <section class="win">
      <h2 class="sect">Completed</h2>
      <ul class="done-list">${done.map((t) => `<li><span class="d num" style="font-size:8px">T${t.doneTurn}</span><span><b>${esc(t.name)}</b> · ${SCHOOLS[t.school].name} by ${esc(t.by)}</span></li>`).join("") || "<li>Nothing cast yet.</li>"}</ul>
    </section>
  </main>`;
}

export function shopView() {
  const s = state;
  return `<main style="display:flex;flex-direction:column;gap:16px">
    <div class="page-head">
      <div>
        <h1 class="page-title">Shop</h1>
        <p class="page-sub">Coin earned on the road, spent on staying on it.</p>
      </div>
      <span class="chip">${coin}<span class="num">${s.hero.gold}</span></span>
    </div>
    <div class="shop-grid">${Object.keys(ITEMS)
      .map((k) => {
        const it = ITEMS[k],
          price = TUNE.items[k].price,
          owned = s.bag[k];
        return `<article class="win item-card">
        <div class="item-top">
          <canvas class="px" data-sprite="item:${k}" data-s="5"></canvas>
          <div><div class="item-name">${it.name}</div><p class="item-desc">${it.desc}</p></div>
        </div>
        <div class="item-foot">
          <span class="price">${coin}${price}<span class="foot-note" style="font-family:var(--body)">· you own ${owned}</span></span>
          <span class="acts">
            ${owned ? `<button class="btn small" data-action="pickItem" data-item="${k}">Use</button>` : ""}
            <button class="btn small primary" data-action="buy" data-item="${k}" ${s.hero.gold < price ? "disabled" : ""}>Buy</button>
          </span>
        </div>
      </article>`;
      })
      .join("")}
    </div>
  </main>`;
}

export function bestiaryView() {
  const s = state;
  const slain = Object.keys(s.defeated).length;
  return `<main style="display:flex;flex-direction:column;gap:22px">
    <div class="page-head">
      <div>
        <h1 class="page-title">Bestiary</h1>
        <p class="page-sub">The Dragon's brood, from the meadows to the peaks. ${slain} of ${ENEMIES.length} kinds slain.</p>
      </div>
    </div>
    ${TIERS.map((t, ti) => {
      const list = ENEMIES.filter((e) => e.tier === ti + 1);
      return `<section class="tier-block">
      <div class="tier-head"><h2>${esc(t.region)}</h2><span class="tier-tag">Tier ${t.roman} · ${t.name} · ${list[0].hp}–${list[5].hp} HP</span></div>
      <p class="task-meta">${esc(t.lore)}</p>
      <div class="beasts">${list
        .map((e) => {
          const seen = s.seen[e.key],
            kills = s.defeated[e.key] || 0,
            cur = s.enemy.key === e.key;
          return `<div class="beast ${seen ? "" : "unseen"} ${cur ? "current" : ""}">
          <div class="art"><canvas class="px" data-sprite="enemy:${e.key}" data-s="${e.base === "dragon" ? 2 : 3}"></canvas></div>
          <div class="b-name">${seen ? esc(e.name) : "???"}</div>
          <div class="b-meta">${cur ? "FIGHTING NOW" : kills ? `SLAIN ×${kills}` : seen ? "SEEN" : `${e.hp} HP`}</div>
          ${seen ? `<div class="b-lore">${esc(e.lore)}</div>` : ""}
        </div>`;
        })
        .join("")}</div>
    </section>`;
    }).join("")}
  </main>`;
}

export function battleView() {
  const e = state.enemy,
    def = enemyDef(e),
    tier = TIERS[def.tier - 1];
  return `<main class="battle">
    <section class="win plate" aria-live="polite">
      <div>
        <div class="tier-tag" id="pl-tier">${esc(tier.region)} · Tier ${tier.roman}</div>
        <div class="plate-name" id="pl-name">${esc(enemyName(e))}</div>
      </div>
      <div class="plate-hp" id="pl-hp">${e.hp} / ${e.maxHp} HP</div>
      <div class="bar hp"><i id="pl-fill" style="width:${pct(e.hp, e.maxHp)}"></i></div>
    </section>
    <div class="stage">
      <canvas id="stage" width="${SW}" height="${SH}" aria-label="Battle scene"></canvas>
      <div class="loot" id="loot" hidden></div>
    </div>
    <div class="cmd-wrap">
      <section class="win">
        <h2 class="sect">Party turn <span id="turn-label">Turn ${state.turn}</span></h2>
        <div id="angel-place"></div>
        <div class="cmd-list" id="cmd-list"></div>
      </section>
      <section class="win blog-wrap">
        <h2 class="sect">Battle log</h2>
        <ol class="log" id="blog"></ol>
        <div class="cmd-actions">
          <button class="btn small vice" data-action="openVices" id="vice-btn">Pay the tithe</button>
          <button class="btn small" data-action="endTurn" id="endturn-btn">End turn</button>
        </div>
        <button class="btn" data-action="flee" id="flee-btn">Run</button>
      </section>
    </div>
  </main>`;
}

export function rewardsView() {
  const r = state.lastRewards;
  if (!r) return campView();
  const e = r.enemy;
  const title = r.gameOver ? "Fallen" : r.kills.length ? "Victory!" : r.fled ? "Escaped" : "Well fought";
  const status = r.gameOver
    ? `${enemyName(e)} stands whole again. It is still there, and so are you.`
    : r.kills.length
      ? `${ENEMY_BY_KEY[r.kills[0]].name} defeated. Next foe: ${enemyName(e)}.`
      : `${enemyName(e)} still stands at ${e.hp} / ${e.maxHp} HP. Its wounds remain.`;
  const pay = r.payout;
  return `<main class="rewards">
    <section class="win r-card">
      <div>
        <div class="eyebrow">${r.turns} turn${r.turns === 1 ? "" : "s"} played · Battle report</div>
        <h1 class="r-title ${r.gameOver ? "over" : ""}">${title}</h1>
        <p class="r-sub">${esc(status)}</p>
      </div>
      ${r.gameOver ? `<div class="r-banner bad"><b>The party fell</b>You woke at camp with 1 HP each.</div>` : ""}
      ${r.dropped ? `<div class="r-banner bad"><b>Coins scattered</b>A failed escape dropped ${r.dropped} gold.</div>` : ""}
      ${r.title1 !== r.title0 ? `<div class="r-banner"><b>New title</b>${esc(state.hero.name)} is now known as “${esc(r.title1)}”.</div>` : ""}
      ${r.hero1 !== r.hero0 ? `<div class="r-banner ${r.hero1 < r.hero0 ? "bad" : ""}"><b>Hero level ${r.hero1 > r.hero0 ? "up" : "down"}</b>The hero is now level ${r.hero1}.</div>` : ""}
      ${r.vices.length ? `<div class="r-banner bad"><b>Tithes paid</b>${esc(r.vices.join(", "))}</div>` : ""}
      <div class="r-stats">
        <div class="r-stat"><span class="r-label">XP shared</span><span class="r-num">${pay ? "+" + pay.xp : "0"}</span><span class="r-note">${pay ? "shared" : "no spoils"}</span></div>
        <div class="r-stat"><span class="r-label">Gold</span><span class="r-num">${pay ? "+" + pay.gold : r.dropped ? signed(-r.dropped) : "0"}</span><span class="r-note">${pay ? "the foe's bounty" : "no bounty"}</span></div>
        <div class="r-stat"><span class="r-label">Damage dealt</span><span class="r-num">${r.dmg}</span><span class="r-note">${r.casts.length} task${r.casts.length === 1 ? "" : "s"} cast</span></div>
        <div class="r-stat"><span class="r-label">Damage taken</span><span class="r-num">${r.dmgTaken}</span><span class="r-note">${r.kos.length ? `${r.kos.length} knocked out` : "no one fell"}</span></div>
      </div>
      <div>
        <h2 class="sect">Party</h2>
        <ul class="r-comps">${r.members
          .map((c) => {
            const a = ATTR[c.attr];
            const ups = [];
            if (c.lv1 > c.lv0)
              ups.push(`<span class="lvup">LV ${c.lv1} · +${(c.lv1 - c.lv0) * TUNE.pointsPerLevel} ${a.name}</span>`);
            if (c.m1 > c.m0) ups.push(`<span class="lvup">MASTERY ${c.m1}</span>`);
            if (c.sp1 > c.sp0) ups.push(`<span class="lvup">${SCHOOLS[a.school].name.toUpperCase()} ${c.sp1}</span>`);
            if (c.fl1 > c.fl0) ups.push(`<span class="lvup">FLEE ${c.fl1}</span>`);
            return `<li style="--c:${a.color}">
          <canvas class="px ${c.ko ? "is-ko" : ""}" data-sprite="comp:${c.id}" data-s="2"></canvas>
          <div><div>${esc(c.name)}</div><div class="meta">${a.cls} · LV ${c.lv1}${c.ko ? " · knocked out" : ""} ${ups.join("")}</div></div>
          <span class="num">${c.xp ? "+" + c.xp + " XP" : "—"}</span>
        </li>`;
          })
          .join("")}</ul>
      </div>
      <button class="btn primary" data-action="toCamp" style="align-self:flex-start">Return to camp</button>
    </section>
  </main>`;
}

// The hero looks to pick from, for joining and for starting over.
function avatarPicker(pick) {
  return `<fieldset class="field" style="border:0;padding:0;margin:0">
    <span>Choose your look</span>
    <div class="avatar-pick">${AVATARS.map(
      (a) => `<label><input type="radio" name="avatar" value="${a.id}" ${a.id === pick ? "checked" : ""}>
      <span class="av"><canvas class="px" data-sprite="avatar:${a.id}" data-s="4"></canvas><span>${a.name}</span></span></label>`,
    ).join("")}</div>
  </fieldset>`;
}
// Sign in, or join with an invite code. Errors are written into the form's .form-err in place,
// so what was typed stays.
export function welcomeView() {
  const join = state.ui.authMode === "join";
  const form = join
    ? `<form id="join-form" class="welcome-form" autocomplete="off">
        <div class="field">
          <label for="j-invite">Invite code</label>
          <input class="text-in" id="j-invite" name="invite" required placeholder="SAGA-XXXX-XXXX" autocapitalize="characters" spellcheck="false">
        </div>
        <div class="add-form">
          <div class="field">
            <label for="j-user">Username <span class="hint-inline">(for signing in, never shown)</span></label>
            <input class="text-in" id="j-user" name="username" required minlength="3" maxlength="24" pattern="[A-Za-z0-9._\\-]+" autocomplete="username" autocapitalize="none" spellcheck="false">
          </div>
          <div class="field">
            <label for="j-pass">Password <span class="hint-inline">(10 characters or more)</span></label>
            <input class="text-in" id="j-pass" name="password" type="password" required minlength="10" maxlength="200" autocomplete="new-password">
          </div>
        </div>
        <div class="field">
          <label for="j-hero">Hero name <span class="hint-inline">(public, in the Hall of Fame)</span></label>
          <input class="text-in" id="j-hero" name="heroName" required maxlength="20" placeholder="e.g. Rowan the Steadfast">
        </div>
        ${avatarPicker("knight")}
        <span class="form-err" role="alert"></span>
        <button type="submit" class="btn primary">Begin</button>
      </form>`
    : `<form id="signin-form" class="welcome-form">
        <div class="add-form">
          <div class="field">
            <label for="s-user">Username</label>
            <input class="text-in" id="s-user" name="username" required autocomplete="username" autocapitalize="none" spellcheck="false">
          </div>
          <div class="field">
            <label for="s-pass">Password</label>
            <input class="text-in" id="s-pass" name="password" type="password" required autocomplete="current-password">
          </div>
        </div>
        <span class="form-err" role="alert"></span>
        <button type="submit" class="btn primary">Sign in</button>
      </form>`;
  return `<main class="welcome">
    <h1 class="welcome-title">HABITS<br>SAGA</h1>
    <p class="welcome-intro">Every habit you keep calls a companion out of the dark. Every deed done is a blow against the Dragon's brood. Who will lead them?</p>
    ${noticeBar()}
    <div class="filters" role="group" aria-label="Sign in or join">
      <button class="fchip" data-action="authMode" data-mode="signin" aria-pressed="${!join}">Sign in</button>
      <button class="fchip" data-action="authMode" data-mode="join" aria-pressed="${join}">Join with an invite</button>
    </div>
    <section class="win">${form}</section>
    <p class="example-note">${
      join
        ? "Joining needs an invite code from the keeper of this realm. Forgot your password later? Ask them for a new one."
        : "Forgot your password? Ask the keeper of this realm for a temporary one."
    } <button class="linkish" data-action="nav" data-view="fame">See the Hall of Fame</button></p>
  </main>`;
}

// After the owner resets a password, the player chooses a new one before playing on.
export function passwordView() {
  return `<main class="welcome">
    <h1 class="welcome-title">HABITS<br>SAGA</h1>
    <p class="welcome-intro">You signed in with a temporary password. Type it once more, then choose your own.</p>
    <section class="win">
      <form id="forced-password-form" class="welcome-form">
        ${passwordFields("f", true)}
        <span class="form-err" role="alert"></span>
        <button type="submit" class="btn primary">Save and continue</button>
      </form>
    </section>
  </main>`;
}
function passwordFields(prefix, withCurrent = false) {
  return `<div class="add-form">
    ${
      withCurrent
        ? `<div class="field full">
          <label for="${prefix}-cur">Current password</label>
          <input class="text-in" id="${prefix}-cur" name="current" type="password" required autocomplete="current-password">
        </div>`
        : ""
    }
    <div class="field">
      <label for="${prefix}-new">New password <span class="hint-inline">(10 characters or more)</span></label>
      <input class="text-in" id="${prefix}-new" name="next" type="password" required minlength="10" maxlength="200" autocomplete="new-password">
    </div>
    <div class="field">
      <label for="${prefix}-again">The same again</label>
      <input class="text-in" id="${prefix}-again" name="again" type="password" required minlength="10" maxlength="200" autocomplete="new-password">
    </div>
  </div>`;
}

export function accountView() {
  const p = account.player;
  return `<main style="display:flex;flex-direction:column;gap:16px;max-width:760px;width:100%;margin:0 auto">
    <div class="page-head">
      <div>
        <h1 class="page-title">Account</h1>
        <p class="page-sub">You sign in as <b>${esc(p.username)}</b>. Your hero, ${esc(p.heroName)}, is the name the Hall of Fame shows. Your game is saved on the server as you play, so you can carry on from any device.</p>
      </div>
      <button class="btn" data-action="signOut">Sign out</button>
    </div>
    <section class="win">
      <h2 class="sect">Sound</h2>
      <div class="slider"><label for="volume">Volume <output id="volume-v">${volume()}</output></label>
        <input type="range" id="volume" min="0" max="100" step="5" value="${volume()}" data-out="volume-v"></div>
      <p class="hint">Sounds play at this volume on this device. 0 is silent.</p>
    </section>
    <section class="win">
      <h2 class="sect">Change password</h2>
      <form id="password-form" class="welcome-form">
        ${passwordFields("p", true)}
        <div class="form-actions"><span class="form-err" role="alert"></span><button type="submit" class="btn primary">Change password</button></div>
      </form>
    </section>
    <section class="win">
      <h2 class="sect">Start over</h2>
      ${
        state.ui.confirmReset
          ? `<form id="hero-form" class="welcome-form" autocomplete="off">
          <p class="page-sub">A new hero starts from nothing: every companion, vice, task, item, foe and point of fame goes. Your account stays.</p>
          <div class="field">
            <label for="h-name">New hero name</label>
            <input class="text-in" id="h-name" name="heroName" required maxlength="20" value="${esc(p.heroName)}">
          </div>
          ${avatarPicker(p.avatar)}
          <div class="form-actions"><span class="form-err" role="alert"></span>
            <button type="button" class="btn" data-action="cancelReset">Keep my game</button>
            <button type="submit" class="btn danger">Start over</button></div>
        </form>`
          : `<div class="inn-row"><p class="inn-text">Leave this game behind and begin again with a new hero.</p>
          <button class="btn small danger" data-action="newCharacter">New character</button></div>`
      }
    </section>
    <section class="win">
      <h2 class="sect">Delete account</h2>
      <form id="delete-form" class="welcome-form">
        <p class="page-sub">Deletes your account, your game and your place in the Hall of Fame, for good.</p>
        <div class="field">
          <label for="d-pass">Your password</label>
          <input class="text-in" id="d-pass" name="password" type="password" required autocomplete="current-password">
        </div>
        <div class="form-actions"><span class="form-err" role="alert"></span><button type="submit" class="btn danger">Delete my account</button></div>
      </form>
    </section>
  </main>`;
}

// The public ranking of real players, loaded from the server (state.ui.ranking).
export function fameView() {
  const s = state,
    by = s.ui.rankBy || "fame",
    r = s.ui.ranking;
  const signedIn = !!account.player;
  const row = (r) => `<tr class="${r.you ? "you" : ""}">
          <td class="num">${r.rank}</td>
          <td><span class="rank-who"><canvas class="px" data-sprite="avatar:${esc(r.avatar)}" data-s="2"></canvas><span><b>${esc(r.heroName)}</b>${r.you ? " (you)" : ""}<span class="t">${esc(fameTitle({ ...r, name: r.heroName }))}</span></span></span></td>
          <td class="r num">${r.fame}</td>
          <td class="r num">${r.level}</td>
          <td>${esc(regionReached(r.front))}</td>
        </tr>`;
  let body;
  if (!r || r.loading) body = '<p class="page-sub">Gathering the heralds…</p>';
  else if (r.failed) body = '<p class="page-sub">The Hall of Fame couldn\'t be loaded. Try again in a moment.</p>';
  else if (!r.rows.length) body = '<p class="page-sub">The heralds have no one to sing of yet.</p>';
  else {
    const below = r.you && !r.rows.some((x) => x.you);
    body = `<table class="rank-table">
        <thead><tr><th>#</th><th>Hero</th><th class="r ${by === "fame" ? "rank-sorted" : ""}">Fame</th><th class="r ${by === "level" ? "rank-sorted" : ""}">Level</th><th>Furthest region</th></tr></thead>
        <tbody>${r.rows.map(row).join("")}${below ? row(r.you) : ""}</tbody>
      </table>`;
  }
  const yours =
    signedIn && r && r.rows
      ? r.you
        ? ` You are rank #${r.you.rank} by ${by}.`
        : " Keep a habit, and they may sing of you."
      : "";
  return `<main style="display:flex;flex-direction:column;gap:16px">
    <div class="page-head">
      <div>
        <h1 class="page-title">Hall of Fame</h1>
        <p class="page-sub">What the heralds sing.${yours}</p>
      </div>
    </div>
    <div class="filters" role="group" aria-label="Rank by">
      <button class="fchip" data-action="rankBy" data-by="fame" aria-pressed="${by === "fame"}">By fame</button>
      <button class="fchip" data-action="rankBy" data-by="level" aria-pressed="${by === "level"}">By level</button>
    </div>
    <section class="win rank-wrap">${body}</section>
  </main>`;
}

/** Loads the ranking for the Hall of Fame and shows it, if the page is still there. */
export async function showRanking(by) {
  state.ui.rankBy = by;
  state.ui.ranking = { loading: true };
  render();
  const data = await fetchRanking(by);
  if (state.ui.view !== "fame" || state.ui.rankBy !== by) return;
  state.ui.ranking = data || { failed: true };
  if (data && data.you) account.rank = by === "fame" ? data.you.rank : account.rank;
  render();
}

// Shortcuts for trying the game out, only in development (pnpm dev): the ranking is public.
export function debugStrip() {
  if (!import.meta.env.DEV || inBattle()) return "";
  return `<footer class="debug" aria-label="Prototype tools">
    <span>Development tools. They change the saved game.</span>
    <button class="btn small" data-action="gold">+100 gold</button>
    <button class="btn small" data-action="noGold">Gold to 0</button>
    <button class="btn small" data-action="kill">Defeat current foe</button>
    <button class="btn small" data-action="skipTier">Skip to next tier</button>
    <button class="btn small" data-action="wipe">Wipe party</button>
    <button class="btn small" data-action="fillAngel">Fill the Angel's bar</button>
  </footer>`;
}

/* ---------- picker dialog: items, item targets, spells, vices, travel, About ---------- */
export function pickerHtml() {
  const s = state,
    p = s.ui.picker;
  if (!p) return "";
  let title,
    sub = "",
    body;
  if (p.type === "about") {
    title = "About Habits Saga";
    body = aboutHtml();
  } else if (p.type === "help") {
    title = "How to play";
    body = helpHtml();
  } else if (p.type === "opening") {
    title = "The Saga of the Turning";
    body = openingHtml();
  } else if (p.type === "angel") {
    title = "The Angel's place";
    sub = "The law gives you the choosing, and only once. Whoever you choose stands there for this hero's whole road.";
    body = `<div class="angel-choice">${Object.entries(ANGELS)
      .map(
        ([id, a]) => `<button class="pick angel-pick" style="--c:${a.color}" data-action="pickAngel" data-who="${id}">
        <img src="${a.painting}" alt="${a.name}">
        <span class="angel-name">${a.name}</span>
        <span>${esc(a.claim)}</span>
        <span class="angel-gift">${esc(a.gift)}</span>
      </button>`,
      )
      .join("")}</div>`;
  } else if (p.type === "items") {
    const user = p.user && findHabit(s, p.user);
    title = inBattle() && user ? `${user.name}: use an item` : "Use an item";
    const keys = Object.keys(ITEMS).filter((k) => s.bag[k]);
    body =
      keys
        .map(
          (k) => `<button class="pick" data-action="pickItem" data-item="${k}">
        <canvas class="px" data-sprite="item:${k}" data-s="3"></canvas>
        <span><span class="pk-name">${ITEMS[k].name}</span><span class="pk-meta">${ITEMS[k].desc}</span></span>
        <span class="cmd-key">×${s.bag[k]}</span></button>`,
        )
        .join("") ||
      `<p class="modal-sub">The bag is empty.${inBattle() ? "" : " The Shop sells potions, ethers, feathers and cures."}</p>`;
  } else if (p.type === "target") {
    const key = p.item;
    title = ITEMS[key].name;
    sub = `${ITEMS[key].desc} You have ${s.bag[key]}.`;
    const units = inBattle()
      ? partyUnits(s)
      : [...s.habits].sort((a, b) => s.party.includes(b.id) - s.party.includes(a.id));
    const eligible = units.filter((u) => canUse(key, u));
    body =
      eligible
        .map(
          (u) => `<button class="pick" style="--c:${ATTR[u.attr].color}" data-action="useOn" data-id="${u.id}">
        <canvas class="px ${isKO(u) ? "is-ko" : ""}" data-sprite="comp:${u.id}" data-s="2"></canvas>
        <span><span class="pk-name">${esc(u.name)}</span><span class="pk-meta">${isKO(u) ? "Knocked out" : `${u.hp}/${maxHpOf(u)} HP · ${u.mp}/${maxMpOf(u)} MP`}${u.statuses.length ? " · " + u.statuses.map((x) => STATUSES[x.id].name).join(", ") : ""} · ${s.party.includes(u.id) ? "in the party" : "on the bench"}</span></span>
        <span class="cmd-key">USE</span></button>`,
        )
        .join("") || `<p class="modal-sub">No one needs this right now.</p>`;
  } else if (p.type === "spells") {
    const u = findHabit(s, p.user),
      sc = schoolOf(u),
      L = spellLvOf(u).level,
      cost = spellCost(u);
    title = `${u.name}: ${SCHOOLS[sc].name} LV ${L}`;
    sub = `Costs ${cost} MP (${u.mp} left).`;
    const tasks = openTasks(s, sc);
    body =
      tasks
        .map(
          (
            t,
          ) => `<button class="pick" style="--c:${ATTR[u.attr].color}" data-action="cast" data-task="${t.id}" ${u.mp < cost ? "disabled" : ""}>
        <span class="ico" aria-hidden="true">${ATTR[u.attr].icon}</span>
        <span><span class="pk-name">${esc(t.name)}</span><span class="pk-meta">${u.mp < cost ? "Not enough MP." : `Cast ${SCHOOLS[sc].name} · ${cost} MP`}</span></span>
        <span class="cmd-key">CAST</span></button>`,
        )
        .join("") || `<p class="modal-sub">No open ${SCHOOLS[sc].name} tasks. Add them in the Spellbook.</p>`;
  } else if (p.type === "vices") {
    title = "Pay the tithe";
    body =
      (p.result ? `<p class="modal-result">${esc(p.result)}</p>` : "") +
      (s.vices
        .map((v) => {
          const a = ATTR[v.attr],
            now = viceNow(v);
          return `<button class="pick" style="--c:var(--vice)" data-action="logVice" data-id="${v.id}">
        <span class="ico" aria-hidden="true">${a.icon}</span>
        <span><span class="pk-name">${esc(v.name)}</span><span class="pk-meta">−${now.drain} ${a.name} · −${now.cost} gold · paid ${v.count}×</span></span>
        <span class="cmd-key">PAY</span></button>${viceConfirm(s, v)}`;
        })
        .join("") || '<p class="modal-sub">No vice has been named yet.</p>') +
      (inBattle()
        ? '<p class="modal-sub">Vices are named at camp, on the Roster.</p>'
        : '<button class="btn small vice" data-action="newVice" style="align-self:flex-start">Name a new vice</button>');
  } else {
    title = "Travel";
    sub = "The road runs both ways.";
    const parts = [];
    if (!atFront(s)) {
      const f = frontPreview(s),
        d = enemyDef(f);
      parts.push(`<button class="pick" style="--c:var(--accent)" data-action="travel" data-to="front">
        <canvas class="px" data-sprite="enemy:${d.key}" data-s="1"></canvas>
        <span><span class="pk-name">Back to the front: ${esc(enemyName(f))}</span><span class="pk-meta">${esc(TIERS[d.tier - 1].region)} · ${f.hp} / ${f.maxHp} HP left</span></span>
        <span class="cmd-key">GO</span></button>`);
    }
    let lastTier = 0;
    for (const i of travelOptions(s)) {
      const e = spawnEnemy(i),
        d = enemyDef(e);
      if (d.tier !== lastTier) {
        parts.push(`<div class="pick-group">${esc(TIERS[d.tier - 1].region)} · Tier ${TIERS[d.tier - 1].roman}</div>`);
        lastTier = d.tier;
      }
      parts.push(`<button class="pick" data-action="travel" data-to="${i}">
        <canvas class="px" data-sprite="enemy:${d.key}" data-s="${d.base === "dragon" ? 1 : 2}"></canvas>
        <span><span class="pk-name">${esc(enemyName(e))}</span><span class="pk-meta">${e.maxHp} HP</span></span>
        <span class="cmd-key">GO</span></button>`);
    }
    body =
      parts.join("") ||
      '<p class="modal-sub">You have not passed any foe yet, so there is nowhere to travel back to.</p>';
  }
  return `<div class="modal-back" data-action="closePicker"></div>
    <section class="win modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button class="btn small" data-action="closePicker">Close</button></div>
      ${sub ? `<p class="modal-sub">${esc(sub)}</p>` : ""}
      <div class="pick-list">${body}</div>
    </section>`;
}
// The About box, opened from the logo. Vite writes Saga's version and the suite's into the page
// when it builds it, from their package.json files.
function aboutHtml() {
  const v = __AXIS_VERSIONS__;
  return `<p class="modal-sub">A habit tracker played as a fantasy game.</p>
    <dl class="about">
      <dt>Version</dt><dd>${esc(v.module)}</dd>
      <dt>Axis Suite</dt><dd>${esc(v.suite)}</dd>
    </dl>
    ${import.meta.env.DEV ? '<p class="modal-sub">Development: these are the numbers of the last release.</p>' : ""}`;
}
// Just enough to get the game rolling. The rest is for the player to find, or in the manual.
function helpHtml() {
  return `<div class="help">
    <p><b>Your habits are your companions.</b> Call one from the Roster and choose what it trains.</p>
    <p><b>Do it, then strike.</b> When you've done a habit in real life, go to battle and attack with its companion. Every blow is a real repetition, and only you know if it was honest.</p>
    <p><b>Tasks are spells.</b> Write one-off tasks in the Spellbook. When you finish one, a companion of its school casts it in battle.</p>
    <p><b>Pay your tithes.</b> Name your vices on the Roster. When one gets the better of you, pay the tithe. It will cost you.</p>
    <p><b>Five walk with you.</b> Choose the five you're working on now. The rest wait on the bench.</p>
    <p><b>Rest at the inn. Visit the shop.</b> Victories pay gold, so spend it.</p>
    <h3>What a habit can train</h3>
    <ul class="help-attrs">${ATTRS.map((a) => `<li><b style="color:${a.color}">${a.icon} ${a.name}</b> ${esc(a.blurb)}</li>`).join("")}</ul>
    <p>The rest is for you to find out.</p>
    <p class="help-links"><a href="https://github.com/diogo431107a-dev/axis-suite/blob/main/saga/docs/manual.md" target="_blank" rel="noopener">Read the manual</a><button type="button" class="linkish" data-action="opening">Hear the tale again</button></p>
  </div>`;
}
// The story's opening: shown once to each hero, and again from the help.
function openingHtml() {
  return `<div class="help">
    <p>Heaven and Hell have never agreed on anything but this: a soul must move to be worth having.</p>
    <p>Then the Elder Dragon woke beneath the Ember Peaks. Where its breath settles, people go on doing today what they did yesterday, and they call this peace. The souls stopped moving.</p>
    <p>So Lunaria and Alecta, an angel and a devil, met on a bare hill under a full moon and made a wager. They would find one soul, so low and so unpromising that even the Dragon's children had stopped bothering with it. If that soul could turn, anyone could.</p>
    <p>They looked for a long time. In the end they found you.</p>
    <p>You wake in a cellar in the meadows. The villagers have a name for you, and it isn't kind. Something small rustles in the grass.</p>
    <button class="btn primary" data-action="afterOpening" style="align-self:flex-start">Get up</button>
  </div>`;
}
export function renderModal() {
  modal.innerHTML = pickerHtml();
  modal.hidden = !state.ui.picker;
  if (state.ui.picker) {
    hydrate(modal);
    const first = modal.querySelector(".pick:not(:disabled), .modal-head .btn");
    if (first) first.focus();
  }
}
export function openPicker(p) {
  state.ui.picker = p;
  state.ui.confirmVice = null;
  renderModal();
}
export function closePicker() {
  state.ui.picker = null;
  state.ui.confirmVice = null;
  renderModal();
}

export const VIEWS = {
  welcome: welcomeView,
  password: passwordView,
  account: accountView,
  camp: campView,
  roster: rosterView,
  spellbook: spellbookView,
  shop: shopView,
  bestiary: bestiaryView,
  fame: fameView,
  battle: battleView,
  rewards: rewardsView,
};
export function render() {
  const view = state.ui.view;
  const bare = view === "welcome" || view === "password";
  const top = bare ? "" : account.player ? header() + noticeBar() : guestHeader();
  app.innerHTML = top + VIEWS[view]() + (bare || !account.player ? "" : debugStrip());
  hydrate(app);
  if (inBattle()) {
    startScene();
    updateCmd();
    updateBattleLog();
  } else stopScene();
  renderModal();
}
export function go(view) {
  state.ui.view = view;
  state.ui.swapFor = null;
  state.ui.noteFor = null;
  state.ui.picker = null;
  state.ui.formErr = "";
  state.ui.confirmReset = false;
  state.ui.confirmDelete = null;
  state.ui.confirmVice = null;
  if (view === "fame") showRanking(state.ui.rankBy || "fame");
  else render();
  if (view === "camp") refreshRank();
  window.scrollTo(0, 0);
}
