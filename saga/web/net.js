import { GAME_VERSION, addLog, freshUi, seed, summaryOf } from "./rules.js";
import { render, setState, state } from "./views.js";

/* =====================================================================
   SERVER — the player's account, loading and saving the game, the ranking
   ===================================================================== */
// The signed-in player ({ username, heroName, avatar, mustChangePassword }), or null.
// rank: the player's place by fame, for the hero sheet. notice: a message shown under the top bar.
export const account = { player: null, rank: null, rankAt: 0, notice: "", saveFailing: false };

// Steps that bring an older save up to date, by the version they upgrade from:
// { 4: s => { … } } turns a version 4 state into version 5. Add one whenever GAME_VERSION goes up.
const MIGRATIONS = {};

/** Calls the API. Never throws: a network failure is { status: 0 } with an error to show. */
export async function api(method, path, body) {
  let res;
  try {
    res = await fetch("/api" + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { status: 0, data: { error: "Can't reach the server. Check the connection and try again." } };
  }
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  return { status: res.status, data };
}

/* ---------- saving ---------- */
// The game is saved whole, a moment after anything changes, so a reload never loses (or undoes)
// a turn. Each save names the revision it builds on; if another tab or device saved in between,
// the server refuses it and hands back the newer game, which this page then shows.
let revision = 0;
let savedJson = null;
let saving = false;
let reloading = false;

// A notice that should outlive a reload of the page.
const NOTICE_KEY = "saga:notice";

/** Reloads the page with a notice to show. Stops whatever the page was doing, a battle included. */
function reloadWith(notice) {
  reloading = true;
  try {
    sessionStorage.setItem(NOTICE_KEY, notice);
  } catch {
    // storage unavailable: reload without the notice
  }
  location.reload();
}

const snapshot = (s) => {
  const game = { ...s };
  delete game.ui;
  return JSON.stringify(game);
};

/** The game from a save, brought up to date, with a fresh page state. */
function adopt(save) {
  const s = save.state;
  while (s.v < GAME_VERSION) {
    MIGRATIONS[s.v](s);
    s.v++;
  }
  // A battle saved mid-way picks up where it was.
  s.ui = freshUi(s.session ? "battle" : "camp");
  setState(s);
  revision = save.revision;
  savedJson = snapshot(s);
}

/** A new game for the signed-in player, saved on the next tick. */
function newGame() {
  const p = account.player;
  setState(seed({ name: p.heroName, avatar: p.avatar }));
  addLog(state, `${p.heroName} takes up the lead. The road begins in the Cellar Meadows.`);
  revision = 0;
  savedJson = null;
}

function updateSaveChip() {
  const chip = document.getElementById("hud-save");
  if (chip) chip.hidden = !account.saveFailing;
}

async function saveNow(keepalive = false) {
  if (!account.player || !state || saving || reloading) return;
  const json = snapshot(state);
  if (json === savedJson) return;
  saving = true;
  const body = `{"baseRevision":${revision},"state":${json},"summary":${JSON.stringify(summaryOf(state))}}`;
  try {
    const res = await fetch("/api/save", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
      // A page being closed may only send small bodies this way; a bigger game is sent normally.
      keepalive: keepalive && body.length < 60000,
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      revision = data.revision;
      savedJson = json;
      account.saveFailing = false;
    } else if (res.status === 409) {
      // Another tab or device saved first. Its game is the one that counts.
      reloadWith("This game was played on another device or tab. Showing the latest.");
    } else if (res.status === 401) {
      reloadWith("You were signed out. Sign in again to keep playing.");
    } else account.saveFailing = true;
  } catch {
    account.saveFailing = true;
  } finally {
    saving = false;
    updateSaveChip();
  }
}

setInterval(saveNow, 1000);
addEventListener("pagehide", () => saveNow(true));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveNow(true);
});

/* ---------- signing in and out ---------- */
function showWelcome(notice = "") {
  setState(seed());
  state.ui = freshUi("welcome");
  account.notice = notice;
  account.rank = null;
  revision = 0;
  savedJson = null;
  render();
}

async function loadGame() {
  const { status, data } = await api("GET", "/save");
  if (status === 200) adopt(data);
  else if (status === 404) newGame();
  else return showWelcome(data.error || "Couldn't load your game. Try again in a moment.");
  if (account.player.mustChangePassword) state.ui.view = "password";
  render();
  refreshRank(true);
}

/** Where the page starts: the player's game if signed in, else the welcome screen. */
export async function boot() {
  try {
    account.notice = sessionStorage.getItem(NOTICE_KEY) || "";
    sessionStorage.removeItem(NOTICE_KEY);
  } catch {
    // storage unavailable: no notice
  }
  const { status, data } = await api("GET", "/me");
  if (status === 200) {
    account.player = data;
    await loadGame();
  } else showWelcome(status === 401 ? account.notice : data.error);
}

/** Signs in or joins (`path` is "/login" or "/signup"). Returns an error to show, or null. */
export async function enter(path, fields) {
  const { status, data } = await api("POST", path, fields);
  if (status !== 200 && status !== 201) return data.error || "That didn't work. Try again.";
  account.player = data;
  account.notice = "";
  await loadGame();
  return null;
}

export async function signOut() {
  await saveNow();
  await api("POST", "/logout");
  account.player = null;
  showWelcome();
}

/* ---------- the account page ---------- */
/** Returns an error to show, or null. */
export async function changePassword(current, next) {
  const { status, data } = await api("PUT", "/password", { current, next });
  if (status !== 204) return data.error || "Couldn't change the password.";
  account.player.mustChangePassword = false;
  return null;
}

export async function deleteAccount(password) {
  const { status, data } = await api("DELETE", "/account", { password });
  if (status !== 204) return data.error || "Couldn't delete the account.";
  account.player = null;
  showWelcome("Your account and your game are gone. Farewell, hero.");
  return null;
}

/** Starts over with a new hero: the saved game goes, the account stays. Returns an error, or null. */
export async function startOver(heroName, avatar) {
  const hero = await api("PUT", "/hero", { heroName, avatar });
  if (hero.status !== 200) return hero.data.error || "Couldn't make the new hero.";
  const cleared = await api("DELETE", "/save");
  if (cleared.status !== 204) return cleared.data.error || "Couldn't start over.";
  account.player = hero.data;
  newGame();
  render();
  window.scrollTo(0, 0);
  refreshRank(true);
  return null;
}

/* ---------- the ranking ---------- */
/** The public ranking, by "fame" or "level": { rows, you }, or null if it couldn't be loaded. */
export async function fetchRanking(by) {
  await saveNow(); // so the player's own row is up to date
  const { status, data } = await api("GET", "/ranking?by=" + by);
  return status === 200 ? data : null;
}

/** Refreshes the player's rank by fame on the hero sheet, at most every 30 seconds. */
export async function refreshRank(force = false) {
  if (!account.player || (!force && Date.now() - account.rankAt < 30_000)) return;
  account.rankAt = Date.now();
  const r = await fetchRanking("fame");
  const rank = r && r.you ? r.you.rank : null;
  if (rank !== account.rank) {
    account.rank = rank;
    if (state.ui.view === "camp" && !state.ui.picker) render();
  }
}
