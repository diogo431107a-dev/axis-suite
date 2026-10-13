// The map's keys, read into what they mean. The map has one tab stop; one node (or an arrow) is
// selected, and keys act on it. Letters are shortcuts, since typing doesn't start editing: Enter
// or F2 does. Ctrl+= and Ctrl+0 are left to the browser's own zoom.
import type { Dir } from "./navigate.ts";

type Keys = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "repeat">;

/** What is selected, which decides what keys mean. */
export type Mode = "none" | "node" | "arrow" | "pick";

export type Intent =
  | { kind: "nav"; dir: Dir }
  | { kind: "home" }
  /** Esc: clear the selection, or stop picking an arrow's target, or go back from an arrow to its node */
  | { kind: "escape" }
  /** edit the node's text, or the arrow's label */
  | { kind: "edit" }
  | { kind: "add-child" }
  | { kind: "add-sibling"; before: boolean }
  | { kind: "move"; dir: Dir }
  | { kind: "move-end"; end: -1 | 1 }
  | { kind: "fold" }
  | { kind: "delete" }
  | { kind: "arrow-start" }
  | { kind: "arrow-next" }
  /** picking an arrow's target: make the arrow */
  | { kind: "confirm" }
  | { kind: "open-link" }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "copy" }
  | { kind: "cut" }
  | { kind: "paste" }
  | { kind: "zoom"; by: "in" | "out" | "fit" }
  | { kind: "menu" }
  | { kind: "help" };

const ARROWS: Record<string, Dir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

/** The letter a key types, a to z: from the key, or from its place on a non-Latin keyboard. */
export function letterOf(e: Pick<KeyboardEvent, "key" | "code">): string | null {
  if (/^[a-z]$/i.test(e.key)) return e.key.toLowerCase();
  const m = /^Key([A-Z])$/.exec(e.code);
  return m ? m[1]!.toLowerCase() : null;
}

/** What a key means in `mode`, or null if the map leaves it to the browser. */
export function intentOf(e: Keys, mode: Mode): Intent | null {
  const mod = e.ctrlKey || e.metaKey;
  const arrow = ARROWS[e.key];
  const letter = letterOf(e);

  if (mod && !e.altKey) {
    if (letter === "z") return e.shiftKey ? { kind: "redo" } : { kind: "undo" };
    if (letter === "y" && !e.shiftKey) return { kind: "redo" };
    if (mode === "pick") return null;
    if (e.shiftKey && arrow && mode === "node") return { kind: "move", dir: arrow };
    if (e.shiftKey && (e.key === "Home" || e.key === "End") && mode === "node") {
      return { kind: "move-end", end: e.key === "Home" ? -1 : 1 };
    }
    if (!e.shiftKey && mode === "node" && letter === "c") return { kind: "copy" };
    if (!e.shiftKey && mode === "node" && letter === "x") return { kind: "cut" };
    if (!e.shiftKey && (mode === "node" || mode === "none") && letter === "v") return { kind: "paste" };
    return null;
  }
  if (e.altKey || mod) return null;

  if (mode === "pick") {
    if (arrow) return { kind: "nav", dir: arrow };
    if (e.key === "Enter" || (letter === "a" && !e.shiftKey)) return { kind: "confirm" };
    if (e.key === "Escape") return { kind: "escape" };
    return null;
  }

  // Shifted keys that type a symbol: + (Shift+= on many keyboards) and ?.
  if (e.key === "+" || e.key === "=") return { kind: "zoom", by: "in" };
  if (e.key === "-" || e.key === "_") return { kind: "zoom", by: "out" };
  if (e.key === "0") return { kind: "zoom", by: "fit" };
  if (e.key === "?") return { kind: "help" };
  if (e.key === "F10" && e.shiftKey && mode === "node") return { kind: "menu" };
  if (e.key === "ContextMenu" && mode === "node") return { kind: "menu" };

  if (mode === "none") {
    if (arrow || e.key === "Home") return { kind: "home" };
    return null;
  }

  if (mode === "arrow") {
    if (e.key === "Enter" || e.key === "F2") return { kind: "edit" };
    if (e.key === "Delete" || e.key === "Backspace") return { kind: "delete" };
    if (e.key === "Escape") return { kind: "escape" };
    if (letter === "a" && e.shiftKey) return { kind: "arrow-next" };
    return null;
  }

  // A node is selected.
  if (arrow && !e.shiftKey) return { kind: "nav", dir: arrow };
  if (e.key === "Home" && !e.shiftKey) return { kind: "home" };
  if (e.key === "Escape") return { kind: "escape" };
  if ((e.key === "Enter" && !e.shiftKey) || e.key === "F2") return { kind: "edit" };
  // Holding a key down would add a node per repeat.
  if (e.repeat && (e.key === "Tab" || e.key === "Insert" || letter === "n" || letter === "a")) return null;
  if ((e.key === "Tab" && !e.shiftKey) || e.key === "Insert") return { kind: "add-child" };
  if (letter === "n") return { kind: "add-sibling", before: e.shiftKey };
  if (e.key === " " && !e.shiftKey) return { kind: "fold" };
  if ((e.key === "Delete" || e.key === "Backspace") && !e.shiftKey) return { kind: "delete" };
  if (letter === "a") return e.shiftKey ? { kind: "arrow-next" } : { kind: "arrow-start" };
  if (letter === "o" && !e.shiftKey) return { kind: "open-link" };
  return null;
}

/** The keys, for the help dialog and the README. */
export const KEY_HELP: [keys: string, what: string][] = [
  ["↑ ↓", "The node above / below, at the same depth on the same side"],
  ["← →", "Toward the root: the parent. Away from it: a child. From the root: into that side"],
  ["Home", "The centre of the map"],
  ["Enter, F2, double-click", "Edit the text"],
  ["While editing: Enter", "Save (Shift+Enter: a new line; Esc: leave it as it was)"],
  ["While editing: Tab / Ctrl+Enter", "Save, and add a child / a node below"],
  ["Tab, Insert", "Add a child"],
  ["N / Shift+N", "Add a node below / above (on the centre: a new branch on the shorter side)"],
  ["Ctrl+Shift+↑ ↓", "Move the node up / down"],
  ["Ctrl+Shift+← →", "Move it one level toward / away from the root (a main branch crosses sides)"],
  ["Ctrl+Shift+Home / End", "Move it to the top / bottom of its siblings"],
  ["Space", "Fold / unfold"],
  ["Delete, Backspace", "Delete the node and its branch (Ctrl+Z brings it back)"],
  ["A", "Draw an arrow from this node: pick the other node with the arrows or a click, then Enter"],
  ["Shift+A", "Go through this node's arrows; then Enter edits the label, Delete removes the arrow"],
  ["O", "Open the link in the node"],
  ["Ctrl+Z / Ctrl+Shift+Z, Ctrl+Y", "Undo / redo"],
  ["Ctrl+C / X / V", "Copy / cut / paste branches, as indented text (Yggdrasil reads it too)"],
  ["+ / − / 0", "Zoom in / out / fit the whole map"],
  ["Shift+F10, Menu key", "The node's menu"],
  ["Esc", "Clear the selection (then Tab leaves the map)"],
  ["?", "These keys"],
];
