import { describe, expect, it } from "vitest";
import type { BoardData, CardMove, CardSummary } from "../../shared/protocol.ts";
import { cardPlacement, moveFocus, placeCard, placeList, shiftedSpot, spotOf, spotText, type Target } from "./model.ts";
import { createSaver } from "./saver.ts";

const card = (id: string, listId: string): CardSummary => ({
  id,
  listId,
  title: id,
  labelIds: [],
  dueDate: null,
  hasDescription: false,
  checklist: { done: 0, total: 0 },
  rev: 1,
});

/** A board from "A B | C | " : lists L0, L1, L2 holding those cards. */
function board(layout: string): BoardData {
  const columns = layout.split("|").map((s) => s.trim().split(/\s+/).filter(Boolean));
  const lists = columns.map((_, i) => ({ id: `L${i}`, name: `List ${i}` }));
  return {
    board: { id: "b", name: "B", color: "blue", cards: 0 },
    lists,
    labels: [],
    cards: columns.flatMap((ids, i) => ids.map((id) => card(id, `L${i}`))),
  };
}

const layoutOf = (data: BoardData) =>
  data.lists
    .map((l) =>
      data.cards
        .filter((c) => c.listId === l.id)
        .map((c) => c.id)
        .join(" "),
    )
    .join(" | ");

describe("placing", () => {
  it("moves a card within a list and to another", () => {
    const data = board("A B C | D |");
    expect(layoutOf(placeCard(data, "A", { listId: "L0", index: 2 }))).toBe("B C A | D | ");
    expect(layoutOf(placeCard(data, "C", { listId: "L1", index: 0 }))).toBe("A B | C D | ");
    expect(layoutOf(placeCard(data, "B", { listId: "L2", index: 9 }))).toBe("A C | D | B");
  });

  it("moves a list with its cards", () => {
    const data = placeList(board("A | B | C"), "L2", 0);
    expect(data.lists.map((l) => l.id)).toEqual(["L2", "L0", "L1"]);
    expect(layoutOf(data)).toBe("C | A | B");
  });

  it("finds the spot of each keyboard move", () => {
    const data = board("A B C | D |");
    expect(shiftedSpot(data, "A", "up")).toBeNull();
    expect(shiftedSpot(data, "A", "down")).toEqual({ listId: "L0", index: 1 });
    expect(shiftedSpot(data, "A", "bottom")).toEqual({ listId: "L0", index: 2 });
    expect(shiftedSpot(data, "C", "top")).toEqual({ listId: "L0", index: 0 });
    expect(shiftedSpot(data, "C", "right")).toEqual({ listId: "L1", index: 1 });
    expect(shiftedSpot(data, "D", "right")).toEqual({ listId: "L2", index: 0 });
    expect(shiftedSpot(data, "A", "left")).toBeNull();
  });

  it("says where a card is", () => {
    expect(spotText(board("A B | C"), "B")).toBe("List 0, 2 of 2");
  });
});

describe("focus", () => {
  const data = board("A B C | D | ");
  const card = (id: string): Target => ({ kind: "card", id });

  it("goes up and down a column, from the name to Add", () => {
    expect(moveFocus(data, card("A"), "up")).toEqual({ kind: "header", listId: "L0" });
    expect(moveFocus(data, { kind: "header", listId: "L0" }, "up")).toBeNull();
    expect(moveFocus(data, card("C"), "down")).toEqual({ kind: "add", listId: "L0" });
    expect(moveFocus(data, { kind: "add", listId: "L0" }, "down")).toBeNull();
    expect(moveFocus(data, card("C"), "home")).toEqual(card("A"));
    expect(moveFocus(data, card("A"), "end")).toEqual(card("C"));
  });

  it("goes across lists at the same height", () => {
    expect(moveFocus(data, card("C"), "right")).toEqual(card("D"));
    expect(moveFocus(data, card("D"), "left")).toEqual(card("A"));
    expect(moveFocus(data, card("D"), "right")).toEqual({ kind: "add", listId: "L2" });
    expect(moveFocus(data, { kind: "header", listId: "L1" }, "right")).toEqual({ kind: "header", listId: "L2" });
    expect(moveFocus(data, { kind: "add", listId: "L2" }, "right")).toBeNull();
  });
});

describe("saving", () => {
  /** A server that keeps each list's order and places a card after the one named. */
  function fakeServer(data: BoardData) {
    const lists = new Map(data.lists.map((l) => [l.id, data.cards.filter((c) => c.listId === l.id).map((c) => c.id)]));
    return {
      move(id: string, { listId, afterId }: CardMove) {
        for (const ids of lists.values()) if (ids.includes(id)) ids.splice(ids.indexOf(id), 1);
        const ids = lists.get(listId)!;
        if (afterId !== null && !ids.includes(afterId)) throw new Error(`${afterId} isn't in ${listId}`);
        ids.splice(afterId === null ? 0 : ids.indexOf(afterId) + 1, 0, id);
      },
      layout: () => [...lists.values()].map((ids) => ids.join(" ")).join(" | "),
    };
  }

  it("brings the server to the page's order, however the moves interleave", async () => {
    let data = board("A B C D | E F |");
    const server = fakeServer(data);
    const sent: string[] = [];
    let done!: () => void;
    const finished = new Promise<void>((resolve) => (done = resolve));
    const saver = createSaver(
      async (id) => {
        await Promise.resolve();
        sent.push(id);
        server.move(
          id,
          cardPlacement(data, id, (other) => other !== id && saver.pending(other)),
        );
      },
      (err) => {
        throw err;
      },
      () => done(),
    );
    const move = (id: string, listId: string, index: number) => {
      data = placeCard(data, id, { listId, index });
      saver.touch(id);
    };
    move("A", "L1", 0);
    move("B", "L1", 1);
    move("A", "L2", 0);
    move("D", "L2", 0);
    move("E", "L0", 0);
    move("A", "L0", 1);
    move("A", "L0", 2);
    await finished;
    expect(server.layout()).toBe(layoutOf(data));
    // A was moved four times but saved at most twice (once in flight, once at the end).
    expect(sent.filter((id) => id === "A").length).toBeLessThanOrEqual(2);
  });

  it("drops what waits when a save fails", async () => {
    const errors: unknown[] = [];
    const sent: string[] = [];
    let done!: () => void;
    const finished = new Promise<void>((resolve) => (done = resolve));
    const saver = createSaver(
      async (key) => {
        sent.push(key);
        if (key === "x") throw new Error("no");
      },
      (err) => errors.push(err),
      () => done(),
    );
    saver.touch("x");
    saver.touch("y");
    await finished;
    expect(sent).toEqual(["x"]);
    expect(errors).toHaveLength(1);
    expect(saver.idle()).toBe(true);
    expect(spotOf(board("A"), "A")).toEqual({ listId: "L0", index: 0 });
  });
});
