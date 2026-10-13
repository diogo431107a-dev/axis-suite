import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { LIMITS, type BoardData } from "../shared/protocol.ts";
import { openDatabase } from "./db.ts";
import { freshRanks, rankAfter } from "./ranks.ts";
import { StoreError, createStore, type Store } from "./store.ts";

/** The StoreError a call throws (fails the test if it doesn't throw one). */
function refusal(fn: () => unknown): StoreError {
  try {
    fn();
  } catch (err) {
    if (err instanceof StoreError) return err;
    throw err;
  }
  throw new Error("expected a StoreError");
}

let db: DatabaseSync;
let store: Store;
let board: BoardData;
/** The template's lists: To do, Doing, Done. */
let todo: string, doing: string, done: string;

beforeEach(() => {
  db = openDatabase(":memory:");
  store = createStore(db);
  const id = store.createBoard("odin", { name: "Work", color: "blue" }).id;
  board = store.board("odin", id);
  [todo, doing, done] = board.lists.map((l) => l.id) as [string, string, string];
});

/** The titles in each list of a board, "To do: A, B | Doing: … ". */
function layout(owner = "odin", boardId = board.board.id): string {
  const data = store.board(owner, boardId);
  return data.lists
    .map(
      (l) =>
        `${l.name}: ${data.cards
          .filter((c) => c.listId === l.id)
          .map((c) => c.title)
          .join(", ")}`,
    )
    .join(" | ");
}

const add = (listId: string, title: string, afterId?: string | null) =>
  store.createCard("odin", { listId, title, ...(afterId === undefined ? {} : { afterId }) }).id;

describe("ranks", () => {
  it("places between neighbours, first and last", () => {
    const [a, b] = freshRanks(2) as [string, string];
    const sibs = [
      { id: "a", rank: a },
      { id: "b", rank: b },
    ];
    const first = rankAfter(sibs, null)!;
    const middle = rankAfter(sibs, "a")!;
    const last = rankAfter(sibs, "b")!;
    expect(first < a && a < middle && middle < b && b < last).toBe(true);
  });

  it("gives up between equal ranks", () => {
    expect(
      rankAfter(
        [
          { id: "a", rank: "a0" },
          { id: "b", rank: "a0" },
        ],
        "a",
      ),
    ).toBeNull();
  });
});

describe("boards", () => {
  it("start from the template, or empty", () => {
    expect(board.lists.map((l) => l.name)).toEqual(["To do", "Doing", "Done"]);
    expect(board.labels.map((l) => l.color)).toEqual(["green", "yellow", "orange", "red", "purple", "blue"]);
    const empty = store.createBoard("odin", { name: "Empty", color: "red", template: false });
    expect(store.board("odin", empty.id)).toMatchObject({ lists: [], labels: [], cards: [] });
  });

  it("are the owner's alone", () => {
    expect(store.boards("freya")).toEqual([]);
    expect(refusal(() => store.board("freya", board.board.id)).status).toBe(404);
    expect(refusal(() => store.createCard("freya", { listId: todo, title: "x" })).status).toBe(404);
    expect(refusal(() => store.deleteBoard("freya", board.board.id)).status).toBe(404);
    expect(store.boards("odin")).toHaveLength(1);
  });

  it("have unique names, ignoring case", () => {
    expect(refusal(() => store.createBoard("odin", { name: "work", color: "red" })).code).toBe("exists");
    store.createBoard("freya", { name: "Work", color: "red" });
  });

  it("check their fields", () => {
    expect(refusal(() => store.createBoard("odin", { name: " ", color: "red" })).code).toBe("invalid");
    expect(refusal(() => store.createBoard("odin", { name: "X", color: "chartreuse" })).code).toBe("invalid");
    expect(refusal(() => store.createBoard("odin", { name: "x".repeat(101), color: "red" })).code).toBe("invalid");
  });

  it("reorder", () => {
    const b = store.createBoard("odin", { name: "B", color: "red" }).id;
    const c = store.createBoard("odin", { name: "C", color: "red" }).id;
    expect(store.moveBoard("odin", c, { afterId: null }).map((x) => x.name)).toEqual(["C", "Work", "B"]);
    expect(store.moveBoard("odin", board.board.id, { afterId: b }).map((x) => x.name)).toEqual(["C", "B", "Work"]);
  });

  it("delete with everything on them", () => {
    const card = add(todo, "A");
    store.createItem("odin", card, { text: "step" });
    store.patchCard("odin", card, { rev: store.card("odin", card).rev, labelIds: [board.labels[0]!.id] });
    store.deleteBoard("odin", board.board.id);
    for (const table of ["lists", "labels", "cards", "card_labels", "checklist_items"]) {
      expect((db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n).toBe(0);
    }
  });
});

describe("cards", () => {
  it("are added last, first, or after one", () => {
    const a = add(todo, "A");
    add(todo, "C");
    add(todo, "First", null);
    add(todo, "B", a);
    expect(layout()).toBe("To do: First, A, B, C | Doing:  | Done: ");
  });

  it("move within a list and between lists", () => {
    const a = add(todo, "A");
    const b = add(todo, "B");
    const c = add(todo, "C");
    store.moveCard("odin", a, { listId: todo, afterId: c });
    expect(layout()).toBe("To do: B, C, A | Doing:  | Done: ");
    store.moveCard("odin", c, { listId: todo, afterId: null });
    expect(layout()).toBe("To do: C, B, A | Doing:  | Done: ");
    // Into an empty list, then after a card there.
    store.moveCard("odin", b, { listId: doing, afterId: null });
    store.moveCard("odin", a, { listId: doing, afterId: b });
    expect(layout()).toBe("To do: C | Doing: B, A | Done: ");
  });

  it("refuse odd moves", () => {
    const a = add(todo, "A");
    const b = add(doing, "B");
    expect(refusal(() => store.moveCard("odin", a, { listId: todo, afterId: a })).code).toBe("invalid");
    // b isn't in To do.
    expect(refusal(() => store.moveCard("odin", a, { listId: todo, afterId: b })).code).toBe("invalid");
    expect(refusal(() => store.moveCard("odin", a, { listId: "nope", afterId: null })).status).toBe(404);
    expect(refusal(() => store.moveCard("odin", a, { listId: todo })).code).toBe("invalid");
  });

  it("re-rank a list whose neighbours have equal ranks", () => {
    const a = add(todo, "A");
    const b = add(todo, "B");
    const c = add(todo, "C");
    db.prepare("UPDATE cards SET rank = 'a0'").run();
    // A, B and C tie; ids decide their order. Put C right after the first of them.
    const order = store.board("odin", board.board.id).cards.map((x) => x.id);
    const [first, second] = order.filter((id) => id !== c) as [string, string];
    store.moveCard("odin", c, { listId: todo, afterId: first });
    const after = store.board("odin", board.board.id).cards.map((x) => x.id);
    expect(after).toEqual([first, c, second]);
    const ranks = (db.prepare("SELECT rank FROM cards ORDER BY rank").all() as { rank: string }[]).map((r) => r.rank);
    expect(new Set(ranks).size).toBe(3);
    expect([a, b]).toContain(first);
  });

  it("move to another board, taking matching labels", () => {
    const other = store.createBoard("odin", { name: "Home", color: "green" });
    const home = store.board("odin", other.id);
    const card = add(todo, "A");
    const named = store.createLabel("odin", { boardId: board.board.id, name: "Urgent", color: "red" });
    const green = board.labels[0]!; // unnamed green: Home has one too
    const card0 = store.card("odin", card);
    store.patchCard("odin", card, { rev: card0.rev, labelIds: [named.id, green.id] });

    const moved = store.moveCard("odin", card, { listId: home.lists[0]!.id, afterId: null });
    expect(moved.droppedLabels).toBe(1);
    expect(moved.card.labelIds).toEqual([home.labels[0]!.id]);
    const full = store.card("odin", card);
    expect(full.boardId).toBe(other.id);
    expect(full.rev).toBeGreaterThan(card0.rev);
    expect(store.boards("odin").map((b) => b.cards)).toEqual([0, 1]);
    // Labels from another board can't be put on it.
    expect(refusal(() => store.patchCard("odin", card, { rev: full.rev, labelIds: [named.id] })).code).toBe("invalid");
  });

  it("edit with rev, and refuse a stale one", () => {
    const id = add(todo, "A");
    const { rev } = store.card("odin", id);
    const saved = store.patchCard("odin", id, {
      rev,
      title: " New\ntitle ",
      description: "line 1\nline 2  ",
      dueDate: "2026-10-20",
    });
    expect(saved).toMatchObject({ title: "New title", description: "line 1\nline 2", dueDate: "2026-10-20" });
    expect(saved.rev).toBeGreaterThan(rev);
    const err = refusal(() => store.patchCard("odin", id, { rev, title: "Old" }));
    expect(err.code).toBe("conflict");
    expect(err.card?.title).toBe("New title");
    expect(refusal(() => store.patchCard("odin", id, { rev: saved.rev, dueDate: "2026-02-30" })).code).toBe("invalid");
    expect(refusal(() => store.patchCard("odin", id, { rev: saved.rev, title: "" })).code).toBe("invalid");
    expect(store.patchCard("odin", id, { rev: saved.rev, dueDate: null }).dueDate).toBeNull();
  });

  it("show on the board with their labels, checklist and description", () => {
    const id = add(todo, "A");
    const [green, , , red] = board.labels;
    store.patchCard("odin", id, { rev: store.card("odin", id).rev, labelIds: [red!.id, green!.id], description: "x" });
    const one = store.createItem("odin", id, { text: "one" });
    store.createItem("odin", id, { text: "two" });
    store.updateItem("odin", one.id, { done: true });
    expect(store.board("odin", board.board.id).cards[0]).toMatchObject({
      labelIds: [green!.id, red!.id],
      hasDescription: true,
      checklist: { done: 1, total: 2 },
    });
  });

  it("keep within the limits", () => {
    const insert = db.prepare(
      `INSERT INTO cards (id, owner, board_id, list_id, rank, title, description, rev, created_at, updated_at)
       VALUES (?, 'odin', ?, ?, 'a0', 't', '', 1, '', '')`,
    );
    for (let i = 0; i < LIMITS.boardCards; i++) insert.run(`c${i}`, board.board.id, done);
    expect(refusal(() => add(todo, "one too many")).code).toBe("too-many");
  });
});

describe("lists", () => {
  it("are added, renamed, moved and deleted with their cards", () => {
    const later = store.createList("odin", { boardId: board.board.id, name: "Later" });
    store.updateList("odin", later.id, { name: "Someday" });
    expect(store.moveList("odin", later.id, { afterId: null }).map((l) => l.name)).toEqual([
      "Someday",
      "To do",
      "Doing",
      "Done",
    ]);
    add(later.id, "A");
    store.deleteList("odin", later.id);
    expect(store.board("odin", board.board.id).cards).toEqual([]);
  });
});

describe("checklist", () => {
  it("adds, ticks, moves and deletes items", () => {
    const card = add(todo, "A");
    const a = store.createItem("odin", card, { text: "a" });
    const b = store.createItem("odin", card, { text: "b" });
    expect(store.moveItem("odin", b.id, { afterId: null }).map((i) => i.text)).toEqual(["b", "a"]);
    expect(store.updateItem("odin", a.id, { done: true, text: "A" })).toMatchObject({ text: "A", done: true });
    store.deleteItem("odin", b.id);
    expect(store.card("odin", card).items).toEqual([{ id: a.id, text: "A", done: true }]);
    expect(refusal(() => store.updateItem("freya", a.id, { done: false })).status).toBe(404);
  });
});

describe("backup", () => {
  it("restores as new boards, for anyone", () => {
    const a = add(todo, "A");
    add(doing, "B");
    store.patchCard("odin", a, {
      rev: store.card("odin", a).rev,
      labelIds: [board.labels[3]!.id],
      dueDate: "2026-11-01",
      description: "notes",
    });
    store.createItem("odin", a, { text: "step" });
    const file = store.exportBoards("odin");
    expect(store.restore("freya", file)).toEqual({ boards: 1, cards: 2 });
    const freyas = store.boards("freya");
    expect(freyas.map((b) => b.name)).toEqual(["Work"]);
    expect(layout("freya", freyas[0]!.id)).toBe(layout());
    const copy = store.board("freya", freyas[0]!.id).cards[0]!;
    expect(store.card("freya", copy.id)).toMatchObject({ description: "notes", dueDate: "2026-11-01" });
    expect(store.exportBoards("freya").boards).toEqual(file.boards);
    // Twice for odin: a second board, renamed.
    store.restore("odin", file);
    expect(store.boards("odin").map((b) => b.name)).toEqual(["Work", "Work (2)"]);
  });

  it("refuses a bad file whole", () => {
    const file = store.exportBoards("odin");
    const bad = {
      ...file,
      boards: [...file.boards, { ...file.boards[0], lists: [{ name: "x", cards: [{ title: "" }] }] }],
    };
    expect(refusal(() => store.restore("freya", bad)).message).toMatch(/^Board 2:/);
    expect(refusal(() => store.restore("freya", { format: "chronos", version: 1 })).code).toBe("invalid");
    expect(store.boards("freya")).toEqual([]);
  });
});

it("removes the boards of users no longer in Heimdall", () => {
  add(todo, "A");
  store.createBoard("loki", { name: "Mischief", color: "red" });
  expect(store.removeUnknownOwners(new Set(["odin"]))).toEqual([{ owner: "loki", cards: 0 }]);
  expect(store.boards("loki")).toEqual([]);
  expect(store.boards("odin")).toHaveLength(1);
});
