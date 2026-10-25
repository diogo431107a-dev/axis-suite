import "@fontsource/press-start-2p/400.css";
import "@fontsource/pixelify-sans/400.css";
import "@fontsource/pixelify-sans/600.css";
import "./style.css";
import "./input.js";
import { seed } from "./rules.js";
import { inBattle, render, setState, state } from "./views.js";

/* =====================================================================
   BOOT
   ===================================================================== */
// The chosen character (name + avatar) is remembered in this browser only, as a convenience.
// Every access is guarded: without storage the game simply asks again next time.
export const STORE_KEY = "habits-fantasy:character";
export function loadCharacter() {
  try {
    const c = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    return c && c.name ? c : null;
  } catch (err) {
    return null;
  }
}
export function saveCharacter(c) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(c));
  } catch (err) {
    /* storage unavailable */
  }
}
export function clearCharacter() {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch (err) {
    /* storage unavailable */
  }
}

function boot() {
  const character = loadCharacter();
  setState(seed(character || {}));
  if (!character) state.ui.view = "welcome";
  if (inBattle() && !state.session) state.ui.view = "camp";
  render();
}
if (document.fonts && document.fonts.load) document.fonts.load('9px "Press Start 2P"').catch(() => {});
boot();
