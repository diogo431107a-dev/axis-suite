import { describe, expect, it } from "vitest";
import { intentOf } from "./keys.ts";
import type { Target } from "./model.ts";

const card: Target = { kind: "card", id: "a" };
const header: Target = { kind: "header", listId: "l" };
const key = (k: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("keys", () => {
  it("move the focus with plain arrows", () => {
    expect(intentOf(key("ArrowDown"), card, false)).toEqual({ kind: "focus", key: "down" });
    expect(intentOf(key("End"), card, false)).toEqual({ kind: "focus", key: "end" });
  });

  it("move cards with Ctrl+Shift, and lists from their name", () => {
    expect(intentOf(key("ArrowUp", { ctrlKey: true, shiftKey: true }), card, false)).toEqual({
      kind: "move",
      dir: "up",
    });
    expect(intentOf(key("Home", { metaKey: true, shiftKey: true }), card, false)).toEqual({ kind: "move", dir: "top" });
    expect(intentOf(key("ArrowLeft", { ctrlKey: true, shiftKey: true }), header, false)).toEqual({
      kind: "move",
      dir: "left",
    });
    expect(intentOf(key("ArrowUp", { ctrlKey: true, shiftKey: true }), header, false)).toBeNull();
    // Ctrl alone and Alt are the browser's.
    expect(intentOf(key("ArrowLeft", { altKey: true }), card, false)).toBeNull();
    expect(intentOf(key("ArrowDown", { ctrlKey: true }), card, false)).toBeNull();
  });

  it("pick up, carry, drop and put back", () => {
    expect(intentOf(key(" "), card, false)).toEqual({ kind: "pick-up" });
    expect(intentOf(key("ArrowRight"), card, true)).toEqual({ kind: "move", dir: "right" });
    expect(intentOf(key("End"), card, true)).toEqual({ kind: "move", dir: "bottom" });
    expect(intentOf(key("Enter"), card, true)).toEqual({ kind: "drop" });
    expect(intentOf(key(" "), card, true)).toEqual({ kind: "drop" });
    expect(intentOf(key("Escape"), card, true)).toEqual({ kind: "put-back" });
    expect(intentOf(key("n"), card, true)).toBeNull();
  });

  it("open, add, delete and help", () => {
    expect(intentOf(key("Enter"), card, false)).toEqual({ kind: "open" });
    expect(intentOf(key("N", { shiftKey: true }), card, false)).toBeNull();
    expect(intentOf(key("n"), header, false)).toEqual({ kind: "new-card" });
    expect(intentOf(key("Delete"), card, false)).toEqual({ kind: "delete" });
    expect(intentOf(key("Delete"), header, false)).toBeNull();
    expect(intentOf(key("?", { shiftKey: true }), header, false)).toEqual({ kind: "help" });
  });
});
