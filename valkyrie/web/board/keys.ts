// The board's keys, read into what they mean. The board has one tab stop; arrows move the focus
// from there (model.ts moveFocus), and Ctrl+Shift with an arrow moves the focused card or list.
// Space picks a card up: plain arrows then carry it, Space or Enter puts it down, Esc puts it back.
import type { Direction, FocusKey, Target } from "./model.ts";

type Keys = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">;

export type Intent =
  | { kind: "focus"; key: FocusKey }
  /** a card (or, from a list's name, the list) one step that way */
  | { kind: "move"; dir: Direction }
  | { kind: "pick-up" }
  | { kind: "drop" }
  | { kind: "put-back" }
  /** open the card, rename the list, or start adding a card */
  | { kind: "open" }
  | { kind: "new-card" }
  | { kind: "delete" }
  | { kind: "help" };

const ARROWS: Record<string, Direction & FocusKey> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** What a key pressed on a target means, or null if the board leaves it to the browser. */
export function intentOf(e: Keys, target: Target, holding: boolean): Intent | null {
  const mod = e.ctrlKey || e.metaKey;
  const arrow = ARROWS[e.key];
  const edge = e.key === "Home" ? "top" : e.key === "End" ? "bottom" : null;

  if (holding) {
    if (e.altKey || mod) return null;
    if (arrow) return { kind: "move", dir: arrow };
    if (edge) return { kind: "move", dir: edge };
    if (e.key === " " || e.key === "Enter") return { kind: "drop" };
    if (e.key === "Escape") return { kind: "put-back" };
    return null;
  }

  if (mod && e.shiftKey && !e.altKey) {
    if (target.kind === "card" && (arrow || edge)) return { kind: "move", dir: (arrow ?? edge)! };
    if (target.kind === "header" && (arrow === "left" || arrow === "right")) return { kind: "move", dir: arrow };
    return null;
  }
  if (mod || e.altKey || e.shiftKey) return e.key === "?" && !mod && !e.altKey ? { kind: "help" } : null;

  if (arrow) return { kind: "focus", key: arrow };
  if (e.key === "Home") return { kind: "focus", key: "home" };
  if (e.key === "End") return { kind: "focus", key: "end" };
  if (e.key === "Enter") return { kind: "open" };
  if (e.key === " " && target.kind === "card") return { kind: "pick-up" };
  if (e.key === " ") return { kind: "open" };
  if (e.key.toLowerCase() === "n") return { kind: "new-card" };
  if (e.key === "Delete" && target.kind === "card") return { kind: "delete" };
  if (e.key === "?") return { kind: "help" };
  return null;
}

/** The keys, for the help dialog and the README. */
export const KEY_HELP: [keys: string, what: string][] = [
  ["↑ ↓ ← →", "Move the focus between cards and lists"],
  ["Home / End", "First / last card of the list"],
  ["Ctrl+Shift+↑ ↓", "Move the card up / down"],
  ["Ctrl+Shift+← →", "Move the card to the next list (on a list's name: move the list)"],
  ["Ctrl+Shift+Home / End", "Move the card to the top / bottom of its list"],
  ["Space", "Pick the card up; then arrows carry it, Space or Enter puts it down, Esc puts it back"],
  ["Enter", "Open the card (on a list's name: rename it)"],
  ["N", "New card at the bottom of the list"],
  ["Delete", "Delete the card"],
  ["?", "These keys"],
];
