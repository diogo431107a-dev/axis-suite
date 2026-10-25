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
import { play, setVolume } from "./sound.js";
import { account, changePassword, deleteAccount, enter, signOut, startOver } from "./net.js";
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
  removeHabit,
  removeTask,
  removeVice,
  restAtInn,
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
  showRanking,
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
    if (buyItem(state, d.item)) play("buy");
    render();
  },
  inn: () => {
    if (restAtInn(state)) play("inn");
    render();
  },
  askDelete: (d) => {
    state.ui.confirmDelete = { kind: d.kind, id: d.id };
    state.ui.confirmVice = null;
    render();
  },
  confirmDelete: () => {
    const c = state.ui.confirmDelete;
    state.ui.confirmDelete = null;
    if (c.kind === "habit") {
      removeHabit(state, c.id);
      if (state.ui.swapFor === c.id) state.ui.swapFor = null;
    } else removeVice(state, c.id);
    render();
  },
  cancelConfirm: () => {
    state.ui.confirmDelete = null;
    state.ui.confirmVice = null;
    if (state.ui.picker) renderModal();
    else render();
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
    if (applyItem(state, p.item, d.id)) play("heal");
    closePicker();
    render();
  },
  openVices: () => {
    if (!busyInBattle()) openPicker({ type: "vices" });
  },
  // Logging a vice asks first: the button shows what it will cost, and Log it confirms.
  logVice: (d) => {
    state.ui.confirmVice = d.id;
    state.ui.confirmDelete = null;
    if (state.ui.picker) renderModal();
    else render();
  },
  confirmVice: () => {
    const id = state.ui.confirmVice;
    state.ui.confirmVice = null;
    const r = logVice(state, id);
    if (r) play("vice");
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
  rankBy: (d) => showRanking(d.by),
  newCharacter: () => {
    state.ui.confirmReset = true;
    render();
    const n = document.getElementById("h-name");
    if (n) n.focus();
  },
  cancelReset: () => {
    state.ui.confirmReset = false;
    render();
  },
  firstHabit: () => {
    state.ui.adding = true;
    state.ui.filter = "all";
    go("roster");
    const n = document.getElementById("f-name");
    if (n) n.focus();
  },
  authMode: (d) => {
    state.ui.authMode = d.mode;
    render();
    const first = app.querySelector("form input:not([type=hidden])");
    if (first) first.focus();
  },
  dismissNotice: () => {
    account.notice = "";
    render();
  },
  signOut: () => signOut(),
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
  if (el.id === "volume") setVolume(el.value);
  if (el.dataset.out) {
    const out = document.getElementById(el.dataset.out);
    if (out) out.textContent = el.value;
  }
});
// Letting go of the volume slider plays a sample at the new volume.
app.addEventListener("change", (e) => {
  if (e.target.id === "volume") play("buy");
});
// Signing in, joining and the account page talk to the server. Their errors are written into the
// form in place, so what was typed stays; the button is disabled while the server answers.
const ACCOUNT_FORMS = {
  "signin-form": (v) => enter("/login", { username: v.username, password: v.password }),
  "join-form": (v) =>
    enter("/signup", {
      invite: v.invite,
      username: v.username,
      password: v.password,
      heroName: v.heroName,
      avatar: v.avatar || "knight",
    }),
  "forced-password-form": async (v) => {
    const err = await changePassword(v.current, v.next);
    if (!err) go("camp");
    return err;
  },
  "password-form": async (v, f) => {
    const err = await changePassword(v.current, v.next);
    if (!err) {
      f.reset();
      account.notice = "Your password is changed. Other devices are signed out.";
      render();
    }
    return err;
  },
  "hero-form": (v) => startOver(v.heroName, v.avatar || "knight"),
  "delete-form": (v) => deleteAccount(v.password),
};
async function submitAccountForm(f) {
  const values = Object.fromEntries(new FormData(f));
  if ("again" in values && values.again !== values.next) return showFormError(f, "The two new passwords don't match.");
  const button = f.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const err = await ACCOUNT_FORMS[f.id](values, f);
    if (err) showFormError(f, err);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}
function showFormError(f, text) {
  const out = f.querySelector(".form-err");
  if (out && out.isConnected) out.textContent = text;
}
app.addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  if (ACCOUNT_FORMS[f.id]) {
    submitAccountForm(f);
    return;
  }
  const name = f.elements.name.value.trim();
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
