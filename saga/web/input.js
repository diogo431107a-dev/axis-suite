import {
  BT,
  afterAction,
  doAct,
  doCast,
  doEndTurn,
  doFlee,
  doGuard,
  doMemberItem,
  doTravel,
  dur,
  startBattle,
  updateBattleLog,
  updateCmd,
  wait,
} from "./battle.js";
import { TUNE } from "./data.js";
import { clearCharacter, saveCharacter } from "./main.js";
import {
  addHabit,
  addLog,
  addTask,
  addVice,
  applyDamage,
  benchMember,
  buyItem,
  defeatEnemy,
  findVice,
  gameOver,
  isWiped,
  joinParty,
  logVice,
  partyUnits,
  removeTask,
  restAtInn,
  seed,
  skipTier,
  swapMember,
  turnDone,
  applyItem,
} from "./rules.js";
import {
  app,
  busyInBattle,
  closePicker,
  go,
  inBattle,
  modal,
  openPicker,
  render,
  renderModal,
  setState,
  state,
} from "./views.js";

/* =====================================================================
   INPUT
   ===================================================================== */
export const ACTIONS = {
  nav: (d) => go(d.view),
  fight: () => startBattle(),
  act: (d) => doAct(d.id),
  guard: (d) => doGuard(d.id),
  endTurn: () => doEndTurn(),
  flee: () => doFlee(),
  toCamp: () => go("camp"),
  join: (d) => {
    if (joinParty(state, d.id) === "full") state.ui.swapFor = d.id;
    render();
  },
  bench: (d) => {
    benchMember(state, d.id);
    render();
  },
  swap: (d) => {
    swapMember(state, d.out, state.ui.swapFor);
    state.ui.swapFor = null;
    render();
  },
  cancelSwap: () => {
    state.ui.swapFor = null;
    render();
  },
  filter: (d) => {
    state.ui.filter = d.attr;
    render();
  },
  toggleAdd: () => {
    state.ui.adding = !state.ui.adding;
    state.ui.formErr = "";
    render();
    if (state.ui.adding) {
      const n = document.getElementById("f-name");
      if (n) n.focus();
    }
  },
  toggleAddVice: () => {
    state.ui.addingVice = !state.ui.addingVice;
    state.ui.formErr = "";
    render();
    if (state.ui.addingVice) {
      const n = document.getElementById("vf-name");
      if (n) n.focus();
    }
  },
  dismissTurn: () => {
    if (state.lastTurn) state.lastTurn.dismissed = true;
    render();
  },
  buy: (d) => {
    buyItem(state, d.item);
    render();
  },
  inn: () => {
    restAtInn(state);
    render();
  },
  removeTask: (d) => {
    removeTask(state, d.id);
    render();
  },
  openItems: (d) => {
    if (!busyInBattle()) openPicker({ type: "items", user: d.user });
  },
  openSpells: (d) => {
    if (!busyInBattle()) openPicker({ type: "spells", user: d.user });
  },
  cast: (d) => doCast(state.ui.picker.user, d.task),
  pickItem: (d) => openPicker({ type: "target", item: d.item, user: state.ui.picker && state.ui.picker.user }),
  useOn: (d) => {
    const p = state.ui.picker;
    if (inBattle()) {
      doMemberItem(p.user, p.item, d.id);
      return;
    }
    applyItem(state, p.item, d.id);
    closePicker();
    render();
  },
  openVices: () => {
    if (!busyInBattle()) openPicker({ type: "vices" });
  },
  logVice: (d) => {
    const r = logVice(state, d.id);
    if (state.ui.picker && state.ui.picker.type === "vices") {
      state.ui.picker.result = r && r.text;
    }
    if (!inBattle()) {
      render();
      return;
    }
    updateCmd();
    updateBattleLog();
    renderModal();
    // an ailment may leave no one able to act: the foe rolls on
    if (turnDone(state) && !BT.busy) {
      closePicker();
      BT.busy = true;
      updateCmd();
      wait(dur(400)).then(afterAction);
    }
  },
  newVice: () => {
    state.ui.addingVice = true;
    state.ui.filter = "all";
    go("roster");
    const n = document.getElementById("vf-name");
    if (n) {
      n.closest("section").scrollIntoView({ block: "center" });
      n.focus({ preventScroll: true });
    }
  },
  openTravel: () => {
    if (!inBattle()) openPicker({ type: "travel" });
  },
  travel: (d) => doTravel(d.to),
  closePicker: () => closePicker(),
  gold: () => {
    state.hero.gold += 100;
    addLog(state, "Found a pouch of 100 gold (prototype tool).");
    render();
  },
  noGold: () => {
    state.hero.gold = 0;
    addLog(state, "The purse is empty (prototype tool).");
    render();
  },
  kill: () => {
    defeatEnemy(state);
    render();
  },
  skipTier: () => {
    skipTier(state);
    render();
  },
  wipe: () => {
    partyUnits(state).forEach((u) => applyDamage(state, u, u.hp));
    if (isWiped(state)) gameOver(state);
    render();
  },
  rankBy: (d) => {
    state.ui.rankBy = d.by;
    render();
  },
  newCharacter: () => {
    if (!state.ui.confirmReset) {
      state.ui.confirmReset = true;
      render();
      setTimeout(() => {
        if (state.ui.confirmReset) {
          state.ui.confirmReset = false;
          render();
        }
      }, 3000);
      return;
    }
    clearCharacter();
    setState(seed());
    state.ui.view = "welcome";
    render();
    window.scrollTo(0, 0);
  },
};
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled || !(app.contains(el) || modal.contains(el))) return;
  const fn = ACTIONS[el.dataset.action];
  if (fn) fn(el.dataset, el);
});
app.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.field && el.dataset.id) {
    const v = findVice(state, el.dataset.id);
    if (v) v[el.dataset.field] = +el.value;
  }
  if (el.dataset.out) {
    const out = document.getElementById(el.dataset.out);
    if (out) out.textContent = el.value;
  }
});
app.addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  const name = f.elements.name.value.trim();
  if (f.id === "welcome-form") {
    const avatar = (f.querySelector('input[name="avatar"]:checked') || {}).value || "knight";
    if (!name) {
      state.ui.avatarPick = avatar;
      state.ui.formErr = "Give your hero a name first.";
      render();
      document.getElementById("w-name").focus();
      return;
    }
    const character = { name, avatar };
    saveCharacter(character);
    setState(seed(character));
    addLog(state, `${name} takes up the lead. The road begins in the Cellar Meadows.`);
    render();
    window.scrollTo(0, 0);
    return;
  }
  if (!name) {
    state.ui.formErr = "Give it a name first.";
    render();
    return;
  }
  state.ui.formErr = "";
  if (f.id === "add-form") {
    const attr = (f.querySelector('input[name="attr"]:checked') || {}).value || "body";
    const h = addHabit(state, { name, attr });
    state.ui.adding = false;
    state.ui.filter = "all";
    if (joinParty(state, h.id) === "full") state.ui.swapFor = h.id;
  } else if (f.id === "vice-form") {
    const attr = (f.querySelector('input[name="attr"]:checked') || {}).value || "body";
    addVice(state, { name, attr, drain: +f.elements.drain.value, cost: +f.elements.cost.value });
    state.ui.addingVice = false;
    state.ui.filter = "all";
  } else if (f.id === "task-form") {
    const school = (f.querySelector('input[name="school"]:checked') || {}).value || "force";
    addTask(state, { name, school });
  }
  render();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.ui.picker) {
    closePicker();
    return;
  }
  if (!inBattle() || state.ui.picker || e.metaKey || e.ctrlKey || e.altKey) return;
  const n = parseInt(e.key, 10);
  const id = state.party[n - 1];
  if (!(n >= 1 && n <= TUNE.partySize && id)) return;
  e.preventDefault();
  doAct(id);
});
