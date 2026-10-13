// The board as the page holds it, and every way it changes: pure functions, so the mouse, the
// keyboard and the tests all move cards the same way. Moves show at once; saver.ts then tells
// the server, naming for each card or list the one it now follows.
import type { BoardData, Card, CardMove, CardSummary, Move } from "../../shared/protocol.ts";

/** A place on the board: a list, and an index among its cards (counted without the card placed there). */
export interface Spot {
  listId: string;
  index: number;
}

export const cardsIn = (data: BoardData, listId: string): CardSummary[] =>
  data.cards.filter((c) => c.listId === listId);

/** Where a card is, or null if it isn't on the board. */
export function spotOf(data: BoardData, cardId: string): Spot | null {
  const card = data.cards.find((c) => c.id === cardId);
  if (!card) return null;
  return { listId: card.listId, index: cardsIn(data, card.listId).indexOf(card) };
}

export const sameSpot = (a: Spot | null, b: Spot | null) => a?.listId === b?.listId && a?.index === b?.index;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** The board with a card put at a spot. */
export function placeCard(data: BoardData, cardId: string, to: Spot): BoardData {
  const card = data.cards.find((c) => c.id === cardId);
  if (!card || !data.lists.some((l) => l.id === to.listId)) return data;
  const rest = data.cards.filter((c) => c.id !== cardId);
  const target = rest.filter((c) => c.listId === to.listId);
  target.splice(clamp(to.index, 0, target.length), 0, { ...card, listId: to.listId });
  return {
    ...data,
    cards: data.lists.flatMap((l) => (l.id === to.listId ? target : rest.filter((c) => c.listId === l.id))),
  };
}

/** The board with a list put at an index (counted without it). Cards follow their lists. */
export function placeList(data: BoardData, listId: string, index: number): BoardData {
  const list = data.lists.find((l) => l.id === listId);
  if (!list) return data;
  const lists = data.lists.filter((l) => l !== list);
  lists.splice(clamp(index, 0, lists.length), 0, list);
  return { ...data, lists, cards: lists.flatMap((l) => cardsIn(data, l.id)) };
}

/** The board without a card. */
export const withoutCard = (data: BoardData, cardId: string): BoardData => ({
  ...data,
  cards: data.cards.filter((c) => c.id !== cardId),
});

/** The board with a card added at the end of its list. */
export const withCard = (data: BoardData, card: CardSummary): BoardData =>
  placeCard({ ...data, cards: [...data.cards, card] }, card.id, {
    listId: card.listId,
    index: cardsIn(data, card.listId).length,
  });

/** The board with what the card dialog shows of a card brought into its face. */
export function withCardChanges(data: BoardData, card: Card): BoardData {
  return {
    ...data,
    cards: data.cards.map((c) =>
      c.id === card.id
        ? {
            ...c,
            title: card.title,
            labelIds: card.labelIds,
            dueDate: card.dueDate,
            hasDescription: card.description !== "",
            checklist: { done: card.items.filter((i) => i.done).length, total: card.items.length },
            rev: card.rev,
          }
        : c,
    ),
  };
}

/**
 * Where to tell the server a card is now: after the nearest card before it that isn't waiting to
 * be saved itself (the server doesn't have those there yet), or first. Saving the waiting ones in
 * turn the same way gives the server the page's order.
 */
export function cardPlacement(data: BoardData, cardId: string, pending: (id: string) => boolean): CardMove {
  const card = data.cards.find((c) => c.id === cardId)!;
  const list = cardsIn(data, card.listId);
  const before = list.slice(0, list.indexOf(card)).filter((c) => !pending(c.id));
  return { listId: card.listId, afterId: before.at(-1)?.id ?? null };
}

/** The same for a list along its board. */
export function listPlacement(data: BoardData, listId: string, pending: (id: string) => boolean): Move {
  const at = data.lists.findIndex((l) => l.id === listId);
  const before = data.lists.slice(0, at).filter((l) => !pending(l.id));
  return { afterId: before.at(-1)?.id ?? null };
}

export type Direction = "up" | "down" | "left" | "right" | "top" | "bottom";

/**
 * Where a card goes when moved one step: up or down its list, to its top or bottom, or to the list
 * on the left or right at the same position (or that list's end). Null when it can't go that way.
 */
export function shiftedSpot(data: BoardData, cardId: string, dir: Direction): Spot | null {
  const at = spotOf(data, cardId);
  if (!at) return null;
  const last = cardsIn(data, at.listId).length - 1;
  switch (dir) {
    case "up":
      return at.index > 0 ? { listId: at.listId, index: at.index - 1 } : null;
    case "down":
      return at.index < last ? { listId: at.listId, index: at.index + 1 } : null;
    case "top":
      return at.index > 0 ? { listId: at.listId, index: 0 } : null;
    case "bottom":
      return at.index < last ? { listId: at.listId, index: last } : null;
    case "left":
    case "right": {
      const li = data.lists.findIndex((l) => l.id === at.listId);
      const next = data.lists[li + (dir === "left" ? -1 : 1)];
      if (!next) return null;
      return { listId: next.id, index: Math.min(at.index, cardsIn(data, next.id).length) };
    }
  }
}

/** Where a list goes when moved one step left or right; null at the edge. */
export function shiftedListIndex(data: BoardData, listId: string, dir: "left" | "right"): number | null {
  const at = data.lists.findIndex((l) => l.id === listId);
  const to = at + (dir === "left" ? -1 : 1);
  return at >= 0 && to >= 0 && to < data.lists.length ? to : null;
}

/** What has the keyboard focus on a board: a list's name, a card, or a list's "Add a card". */
export type Target =
  { kind: "header"; listId: string } | { kind: "card"; id: string } | { kind: "add"; listId: string };

export type FocusKey = "up" | "down" | "left" | "right" | "home" | "end";

/** The list a target is in, and its place in that list's column: name 0, cards 1…n, "Add" n+1. */
function locate(data: BoardData, t: Target): { listIndex: number; row: number } | null {
  if (t.kind === "card") {
    const at = spotOf(data, t.id);
    if (!at) return null;
    return { listIndex: data.lists.findIndex((l) => l.id === at.listId), row: at.index + 1 };
  }
  const listIndex = data.lists.findIndex((l) => l.id === t.listId);
  if (listIndex < 0) return null;
  return { listIndex, row: t.kind === "header" ? 0 : cardsIn(data, t.listId).length + 1 };
}

function targetAt(data: BoardData, listIndex: number, row: number): Target {
  const list = data.lists[listIndex]!;
  const cards = cardsIn(data, list.id);
  if (row <= 0) return { kind: "header", listId: list.id };
  if (row > cards.length) return { kind: "add", listId: list.id };
  return { kind: "card", id: cards[row - 1]!.id };
}

/**
 * Where the focus goes from a target: up and down its column, Home and End to the first and last
 * card, left and right to the same kind of thing in the next list (a card at the same position,
 * or the last one; "Add a card" in a list with none). Null when there is nowhere to go.
 */
export function moveFocus(data: BoardData, from: Target, key: FocusKey): Target | null {
  const at = locate(data, from);
  if (!at) return null;
  const n = cardsIn(data, data.lists[at.listIndex]!.id).length;
  let next: Target;
  switch (key) {
    case "up":
      if (at.row === 0) return null;
      next = targetAt(data, at.listIndex, at.row - 1);
      break;
    case "down":
      if (at.row === n + 1) return null;
      next = targetAt(data, at.listIndex, at.row + 1);
      break;
    case "home":
      next = targetAt(data, at.listIndex, n > 0 ? 1 : 0);
      break;
    case "end":
      next = targetAt(data, at.listIndex, n > 0 ? n : n + 1);
      break;
    case "left":
    case "right": {
      const li = at.listIndex + (key === "left" ? -1 : 1);
      if (li < 0 || li >= data.lists.length) return null;
      const m = cardsIn(data, data.lists[li]!.id).length;
      const row = from.kind === "header" ? 0 : from.kind === "add" ? m + 1 : Math.min(at.row, Math.max(m, 1));
      next = targetAt(data, li, m === 0 && from.kind === "card" ? 1 : row);
      break;
    }
  }
  return sameTarget(next, from) ? null : next;
}

export function sameTarget(a: Target | null, b: Target | null): boolean {
  if (!a || !b || a.kind !== b.kind) return a === b;
  return a.kind === "card" ? a.id === (b as { id: string }).id : a.listId === (b as { listId: string }).listId;
}

/** Whether a target is still on the board. */
export const targetExists = (data: BoardData, t: Target) => locate(data, t) !== null;

/** "Doing, 2 of 5", for telling a screen reader where a card is. */
export function spotText(data: BoardData, cardId: string): string {
  const at = spotOf(data, cardId);
  if (!at) return "";
  const list = data.lists.find((l) => l.id === at.listId)!;
  return `${list.name}, ${at.index + 1} of ${cardsIn(data, at.listId).length}`;
}
