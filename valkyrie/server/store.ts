import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { isDate } from "../shared/dates.ts";
import {
  COLORS,
  LIMITS,
  TEMPLATE,
  type Board,
  type BoardData,
  type Card,
  type CardMoved,
  type CardSummary,
  type ChecklistItem,
  type Color,
  type ErrorCode,
  type ExportBoard,
  type ExportCard,
  type ExportFile,
  type Label,
  type List,
  type RestoreResult,
} from "../shared/protocol.ts";
import { freshRanks, rankAfter, rankAtEnd, type Ranked } from "./ranks.ts";

// The only place boards, lists, cards and their checklists are read and written. Every query
// names the owner (a Heimdall username), so nobody reaches another user's boards; a row that
// belongs to someone else answers exactly like one that doesn't exist.

/** A request the store refuses, with the HTTP status to answer. */
export class StoreError extends Error {
  readonly status: number;
  readonly code: ErrorCode | undefined;
  /** with "conflict": the card as it is now */
  readonly card: Card | undefined;
  constructor(status: number, message: string, code?: ErrorCode, card?: Card) {
    super(message);
    this.status = status;
    this.code = code;
    this.card = card;
  }
}

interface BoardRow {
  id: string;
  name: string;
  color: Color;
  rank: string;
  cards: number;
}

interface ListRow {
  id: string;
  board_id: string;
  name: string;
  rank: string;
}

interface LabelRow {
  id: string;
  board_id: string;
  name: string;
  color: Color;
  rank: string;
}

interface CardRow {
  id: string;
  owner: string;
  board_id: string;
  list_id: string;
  rank: string;
  title: string;
  description: string;
  due_date: string | null;
  rev: number;
  created_at: string;
  updated_at: string;
}

interface SummaryRow {
  id: string;
  list_id: string;
  title: string;
  due_date: string | null;
  rev: number;
  has_description: number;
  total: number;
  done: number;
}

interface ItemRow {
  id: string;
  card_id: string;
  text: string;
  done: number;
  rank: string;
}

function invalid(message: string): never {
  throw new StoreError(400, message, "invalid");
}

const notFound = (what: string): never => {
  throw new StoreError(404, `No such ${what}`, "not-found");
};

const tooMany = (message: string): never => {
  throw new StoreError(409, message, "too-many");
};

function objectBody(input: unknown, what = "The request body"): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) invalid(`${what} must be a JSON object`);
  return input as Record<string, unknown>;
}

/** A one-line text field (names, titles): line breaks and runs of spaces become one space. */
function line(value: unknown, name: string, max: number, required: boolean): string {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") invalid(`${name} must be text`);
  const s = value.replace(/\s+/g, " ").trim();
  if (required && !s) invalid(`${name} is empty`);
  if (s.length > max) invalid(`${name} is longer than ${max} characters`);
  return s;
}

/** A text of several lines (a description): only the trailing space goes. */
function block(value: unknown, name: string, max: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") invalid(`${name} must be text`);
  const s = value.trimEnd();
  if (s.length > max) invalid(`${name} is longer than ${max} characters`);
  return s;
}

function color(value: unknown): Color {
  if (!COLORS.includes(value as Color)) invalid(`The colour must be one of ${COLORS.join(", ")}`);
  return value as Color;
}

function dueDate(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (!isDate(value)) invalid("The due date must be a date, YYYY-MM-DD");
  return value;
}

/** A move's `afterId`: an id, or null for first. */
function afterIdOf(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !value) invalid("afterId must be an id, or null to go first");
  return value;
}

const boardName = (value: unknown) => line(value, "The board's name", LIMITS.nameChars, true);
const listName = (value: unknown) => line(value, "The list's name", LIMITS.nameChars, true);
const labelName = (value: unknown) => line(value, "The label's name", LIMITS.nameChars, false);
const cardTitle = (value: unknown) => line(value, "The card's title", LIMITS.titleChars, true);
const itemText = (value: unknown) => line(value, "The checklist item", LIMITS.itemChars, true);
const description = (value: unknown) => block(value, "The description", LIMITS.descriptionChars);

/** Names compare without case: "Work" and "work" are the same board. */
const nameKey = (name: string) => name.normalize("NFC").toLowerCase();

const labelKey = (l: { name: string; color: Color }) => `${nameKey(l.name)}\n${l.color}`;

export function createStore(db: DatabaseSync) {
  const BOARD = `SELECT b.id, b.name, b.color, b.rank,
      (SELECT count(*) FROM cards c WHERE c.board_id = b.id) AS cards
    FROM boards b WHERE b.owner = ?`;
  const selectBoards = db.prepare(`${BOARD} ORDER BY b.rank, b.id`);
  const selectBoard = db.prepare(`${BOARD} AND b.id = ?`);
  const insertBoard = db.prepare(
    "INSERT INTO boards (id, owner, name, color, rank, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const updateBoardRow = db.prepare("UPDATE boards SET name = ?, color = ?, updated_at = ? WHERE id = ? AND owner = ?");
  const setBoardRank = db.prepare("UPDATE boards SET rank = ? WHERE id = ?");
  const deleteBoardRow = db.prepare("DELETE FROM boards WHERE id = ? AND owner = ?");

  const selectLists = db.prepare("SELECT id, board_id, name, rank FROM lists WHERE board_id = ? ORDER BY rank, id");
  const selectList = db.prepare("SELECT id, board_id, name, rank FROM lists WHERE id = ? AND owner = ?");
  const insertList = db.prepare(
    "INSERT INTO lists (id, owner, board_id, name, rank, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const updateListName = db.prepare("UPDATE lists SET name = ?, updated_at = ? WHERE id = ?");
  const setListRank = db.prepare("UPDATE lists SET rank = ? WHERE id = ?");
  const deleteListRow = db.prepare("DELETE FROM lists WHERE id = ? AND owner = ?");

  const selectLabels = db.prepare(
    "SELECT id, board_id, name, color, rank FROM labels WHERE board_id = ? ORDER BY rank, id",
  );
  const selectLabel = db.prepare("SELECT id, board_id, name, color, rank FROM labels WHERE id = ? AND owner = ?");
  const insertLabel = db.prepare(
    "INSERT INTO labels (id, owner, board_id, name, color, rank) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const updateLabelRow = db.prepare("UPDATE labels SET name = ?, color = ? WHERE id = ?");
  const deleteLabelRow = db.prepare("DELETE FROM labels WHERE id = ? AND owner = ?");

  const SUMMARY = `SELECT c.id, c.list_id, c.title, c.due_date, c.rev, c.description <> '' AS has_description,
      (SELECT count(*) FROM checklist_items i WHERE i.card_id = c.id) AS total,
      (SELECT count(*) FROM checklist_items i WHERE i.card_id = c.id AND i.done = 1) AS done
    FROM cards c`;
  const selectSummaries = db.prepare(
    `${SUMMARY} JOIN lists l ON l.id = c.list_id WHERE c.board_id = ? ORDER BY l.rank, l.id, c.rank, c.id`,
  );
  const selectSummary = db.prepare(`${SUMMARY} WHERE c.id = ?`);
  const selectBoardCardLabels = db.prepare(
    `SELECT cl.card_id, cl.label_id FROM card_labels cl JOIN labels lb ON lb.id = cl.label_id
     WHERE lb.board_id = ? ORDER BY lb.rank, lb.id`,
  );
  const selectCardLabels = db.prepare(
    `SELECT cl.label_id FROM card_labels cl JOIN labels lb ON lb.id = cl.label_id
     WHERE cl.card_id = ? ORDER BY lb.rank, lb.id`,
  );
  const selectCard = db.prepare("SELECT * FROM cards WHERE id = ? AND owner = ?");
  const selectListCards = db.prepare("SELECT * FROM cards WHERE list_id = ? ORDER BY rank, id");
  const insertCard = db.prepare(
    `INSERT INTO cards (id, owner, board_id, list_id, rank, title, description, due_date, rev, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateCardFields = db.prepare(
    "UPDATE cards SET title = ?, description = ?, due_date = ?, rev = ?, updated_at = ? WHERE id = ?",
  );
  const setCardPlace = db.prepare(
    "UPDATE cards SET board_id = ?, list_id = ?, rank = ?, rev = ?, updated_at = ? WHERE id = ?",
  );
  const setCardRank = db.prepare("UPDATE cards SET rank = ? WHERE id = ?");
  const deleteCardRow = db.prepare("DELETE FROM cards WHERE id = ? AND owner = ?");
  const insertCardLabel = db.prepare("INSERT OR IGNORE INTO card_labels (card_id, label_id) VALUES (?, ?)");
  const deleteCardLabels = db.prepare("DELETE FROM card_labels WHERE card_id = ?");

  const countBoards = db.prepare("SELECT count(*) AS n FROM boards WHERE owner = ?");
  const countBoardCards = db.prepare("SELECT count(*) AS n FROM cards WHERE board_id = ?");
  const countUserCards = db.prepare("SELECT count(*) AS n FROM cards WHERE owner = ?");

  const selectItems = db.prepare(
    "SELECT id, card_id, text, done, rank FROM checklist_items WHERE card_id = ? ORDER BY rank, id",
  );
  const selectItem = db.prepare("SELECT id, card_id, text, done, rank FROM checklist_items WHERE id = ? AND owner = ?");
  const insertItem = db.prepare(
    "INSERT INTO checklist_items (id, owner, card_id, text, done, rank) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const updateItemRow = db.prepare("UPDATE checklist_items SET text = ?, done = ? WHERE id = ?");
  const setItemRank = db.prepare("UPDATE checklist_items SET rank = ? WHERE id = ?");
  const deleteItemRow = db.prepare("DELETE FROM checklist_items WHERE id = ? AND owner = ?");

  const nextRev = db.prepare("UPDATE meta SET value = value + 1 WHERE key = 'rev' RETURNING value");

  // $known: a JSON array of usernames.
  const UNKNOWN_OWNER = "owner NOT IN (SELECT value FROM json_each($known))";
  const countUnknownOwners = db.prepare(`
    SELECT owner, (SELECT count(*) FROM cards c WHERE c.owner = b.owner) AS cards
    FROM boards b WHERE ${UNKNOWN_OWNER} GROUP BY owner ORDER BY owner`);
  // Boards take their lists, labels, cards and checklists with them.
  const deleteUnknown = db.prepare(`DELETE FROM boards WHERE ${UNKNOWN_OWNER}`);

  /** Runs `fn` in one transaction. */
  function transaction<T>(fn: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  const newRev = () => (nextRev.get() as { value: number }).value;
  const count = (stmt: { get: (...a: string[]) => unknown }, ...args: string[]) =>
    (stmt.get(...args) as { n: number }).n;

  const toBoard = (row: BoardRow): Board => ({ id: row.id, name: row.name, color: row.color, cards: row.cards });
  const toList = (row: ListRow): List => ({ id: row.id, name: row.name });
  const toLabel = (row: LabelRow): Label => ({ id: row.id, name: row.name, color: row.color });
  const toItem = (row: ItemRow): ChecklistItem => ({ id: row.id, text: row.text, done: row.done === 1 });
  const toSummary = (row: SummaryRow, labelIds: string[]): CardSummary => ({
    id: row.id,
    listId: row.list_id,
    title: row.title,
    labelIds,
    dueDate: row.due_date,
    hasDescription: row.has_description === 1,
    checklist: { done: row.done, total: row.total },
    rev: row.rev,
  });

  const boardRows = (owner: string) => selectBoards.all(owner) as unknown as BoardRow[];
  const boardRow = (owner: string, id: string) =>
    (selectBoard.get(owner, id) as BoardRow | undefined) ?? notFound("board");
  const listRows = (boardId: string) => selectLists.all(boardId) as unknown as ListRow[];
  const listRow = (owner: string, id: unknown): ListRow =>
    (typeof id === "string" && (selectList.get(id, owner) as ListRow | undefined)) || notFound("list");
  const labelRows = (boardId: string) => selectLabels.all(boardId) as unknown as LabelRow[];
  const labelRow = (owner: string, id: string) =>
    (selectLabel.get(id, owner) as LabelRow | undefined) ?? notFound("label");
  const cardRow = (owner: string, id: string) => (selectCard.get(id, owner) as CardRow | undefined) ?? notFound("card");
  const listCards = (listId: string) => selectListCards.all(listId) as unknown as CardRow[];
  const itemRows = (cardId: string) => selectItems.all(cardId) as unknown as ItemRow[];
  const itemRow = (owner: string, id: string) =>
    (selectItem.get(id, owner) as ItemRow | undefined) ?? notFound("checklist item");
  const cardLabelIds = (cardId: string) =>
    (selectCardLabels.all(cardId) as { label_id: string }[]).map((r) => r.label_id);

  function summary(id: string): CardSummary {
    return toSummary(selectSummary.get(id) as unknown as SummaryRow, cardLabelIds(id));
  }

  function fullCard(row: CardRow): Card {
    return {
      id: row.id,
      boardId: row.board_id,
      listId: row.list_id,
      title: row.title,
      description: row.description,
      dueDate: row.due_date,
      labelIds: cardLabelIds(row.id),
      items: itemRows(row.id).map(toItem),
      rev: row.rev,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * The rank for an item placed after `afterId` among `siblings` (in order, without the item). If
   * equal ranks leave no room there, the siblings are re-ranked first (with `setRank`).
   */
  function place(
    siblings: Ranked[],
    afterId: string | null,
    what: string,
    setRank: (id: string, rank: string) => void,
  ) {
    if (afterId !== null && !siblings.some((s) => s.id === afterId)) invalid(`That ${what} isn't there to follow`);
    const rank = rankAfter(siblings, afterId);
    if (rank !== null) return rank;
    const fresh = freshRanks(siblings.length);
    const respread = siblings.map((s, i) => {
      setRank(s.id, fresh[i]!);
      return { id: s.id, rank: fresh[i]! };
    });
    return rankAfter(respread, afterId)!;
  }

  function checkBoardName(owner: string, name: string, exceptId?: string): void {
    const clash = boardRows(owner).find((b) => b.id !== exceptId && nameKey(b.name) === nameKey(name));
    if (clash) throw new StoreError(409, `There is already a board called ${clash.name}`, "exists");
  }

  /** A name like `name` that no board has yet: "Work", "Work (2)", … */
  function freeName(owner: string, name: string): string {
    const taken = new Set(boardRows(owner).map((b) => nameKey(b.name)));
    let candidate = name;
    for (let n = 2; taken.has(nameKey(candidate)); n++) {
      const suffix = ` (${n})`;
      candidate = name.slice(0, LIMITS.nameChars - suffix.length) + suffix;
    }
    return candidate;
  }

  function addBoard(owner: string, name: string, boardColor: Color): string {
    if (count(countBoards, owner) >= LIMITS.boards) tooMany(`At most ${LIMITS.boards} boards`);
    const id = randomUUID();
    const now = new Date().toISOString();
    insertBoard.run(id, owner, name, boardColor, rankAtEnd(boardRows(owner)), now, now);
    return id;
  }

  function addList(owner: string, boardId: string, name: string): string {
    const lists = listRows(boardId);
    if (lists.length >= LIMITS.lists) tooMany(`At most ${LIMITS.lists} lists on a board`);
    const id = randomUUID();
    const now = new Date().toISOString();
    insertList.run(id, owner, boardId, name, rankAtEnd(lists), now, now);
    return id;
  }

  function addLabel(owner: string, boardId: string, name: string, labelColor: Color): string {
    const labels = labelRows(boardId);
    if (labels.length >= LIMITS.labels) tooMany(`At most ${LIMITS.labels} labels on a board`);
    const id = randomUUID();
    insertLabel.run(id, owner, boardId, name, labelColor, rankAtEnd(labels));
    return id;
  }

  /** Room for `adding` more cards on a board and for the user. */
  function checkCardRoom(owner: string, boardId: string, adding = 1): void {
    if (count(countBoardCards, boardId) + adding > LIMITS.boardCards) {
      tooMany(`At most ${LIMITS.boardCards} cards on a board`);
    }
    if (count(countUserCards, owner) + adding > LIMITS.cards) tooMany(`At most ${LIMITS.cards} cards`);
  }

  function addCard(
    owner: string,
    list: ListRow,
    rank: string,
    fields: { title: string; description: string; dueDate: string | null },
  ): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    insertCard.run(
      id,
      owner,
      list.board_id,
      list.id,
      rank,
      fields.title,
      fields.description,
      fields.dueDate,
      newRev(),
      now,
      now,
    );
    return id;
  }

  function addItem(owner: string, cardId: string, text: string, done: boolean, rank: string): string {
    const id = randomUUID();
    insertItem.run(id, owner, cardId, text, done ? 1 : 0, rank);
    return id;
  }

  /** Label ids from a request: labels of the board, each once, in the board's order. */
  function labelIdsOf(value: unknown, boardId: string): string[] {
    if (!Array.isArray(value)) invalid("labelIds must be a list of label ids");
    const wanted = new Set(value);
    const labels = labelRows(boardId);
    for (const id of wanted) {
      if (!labels.some((l) => l.id === id)) invalid("A label isn't on this card's board");
    }
    return labels.filter((l) => wanted.has(l.id)).map((l) => l.id);
  }

  function exportBoard(board: BoardRow): ExportBoard {
    const labels = labelRows(board.id);
    const labelIndex = new Map(labels.map((l, i) => [l.id, i]));
    return {
      name: board.name,
      color: board.color,
      labels: labels.map((l) => ({ name: l.name, color: l.color })),
      lists: listRows(board.id).map((list) => ({
        name: list.name,
        cards: listCards(list.id).map((c): ExportCard => ({
          title: c.title,
          description: c.description,
          dueDate: c.due_date,
          labels: cardLabelIds(c.id).map((id) => labelIndex.get(id)!),
          items: itemRows(c.id).map((i) => ({ text: i.text, done: i.done === 1 })),
        })),
      })),
    };
  }

  /** A board from a backup, checked. */
  function importBoardOf(input: unknown): ExportBoard {
    const b = objectBody(input);
    if (!Array.isArray(b.labels)) invalid("labels must be a list");
    if (!Array.isArray(b.lists)) invalid("lists must be a list");
    if (b.labels.length > LIMITS.labels) invalid(`At most ${LIMITS.labels} labels on a board`);
    if (b.lists.length > LIMITS.lists) invalid(`At most ${LIMITS.lists} lists on a board`);
    const labels = b.labels.map((value) => {
      const l = objectBody(value, "A label");
      return { name: labelName(l.name), color: color(l.color) };
    });
    let cards = 0;
    const lists = b.lists.map((value) => {
      const l = objectBody(value, "A list");
      if (!Array.isArray(l.cards)) invalid("A list's cards must be a list");
      cards += l.cards.length;
      if (cards > LIMITS.boardCards) invalid(`At most ${LIMITS.boardCards} cards on a board`);
      return {
        name: listName(l.name),
        cards: l.cards.map((value): ExportCard => {
          const c = objectBody(value, "A card");
          const cardLabels = c.labels ?? [];
          if (
            !Array.isArray(cardLabels) ||
            cardLabels.some((i) => !Number.isInteger(i) || i < 0 || i >= labels.length)
          ) {
            invalid("A card's labels must be numbers of the board's labels");
          }
          const items = c.items ?? [];
          if (!Array.isArray(items)) invalid("A card's items must be a list");
          if (items.length > LIMITS.items) invalid(`At most ${LIMITS.items} checklist items on a card`);
          return {
            title: cardTitle(c.title),
            description: description(c.description),
            dueDate: dueDate(c.dueDate),
            labels: cardLabels as number[],
            items: items.map((value) => {
              const i = objectBody(value, "A checklist item");
              return { text: itemText(i.text), done: i.done === true };
            }),
          };
        }),
      };
    });
    return {
      name: boardName(b.name),
      color: COLORS.includes(b.color as Color) ? (b.color as Color) : "stone",
      labels,
      lists,
    };
  }

  return {
    // ── Boards ───────────────────────────────────────────────────────────────────────────────

    boards(owner: string): Board[] {
      return boardRows(owner).map(toBoard);
    },

    /** The whole board, in the order shown. */
    board(owner: string, id: string): BoardData {
      const board = boardRow(owner, id);
      const labelsOf = new Map<string, string[]>();
      for (const { card_id, label_id } of selectBoardCardLabels.all(id) as { card_id: string; label_id: string }[]) {
        labelsOf.set(card_id, [...(labelsOf.get(card_id) ?? []), label_id]);
      }
      return {
        board: toBoard(board),
        lists: listRows(id).map(toList),
        labels: labelRows(id).map(toLabel),
        cards: (selectSummaries.all(id) as unknown as SummaryRow[]).map((row) =>
          toSummary(row, labelsOf.get(row.id) ?? []),
        ),
      };
    },

    /** A new board, last in the list; with the template's lists and labels unless `template` is false. */
    createBoard(owner: string, input: unknown): Board {
      const b = objectBody(input);
      const name = boardName(b.name);
      const boardColor = color(b.color);
      return transaction(() => {
        checkBoardName(owner, name);
        const id = addBoard(owner, name, boardColor);
        if (b.template !== false) {
          for (const list of TEMPLATE.lists) addList(owner, id, list);
          for (const c of TEMPLATE.labels) addLabel(owner, id, "", c);
        }
        return toBoard(boardRow(owner, id));
      });
    },

    updateBoard(owner: string, id: string, input: unknown): Board {
      const b = objectBody(input);
      return transaction(() => {
        const board = boardRow(owner, id);
        const name = b.name === undefined ? board.name : boardName(b.name);
        const boardColor = b.color === undefined ? board.color : color(b.color);
        checkBoardName(owner, name, id);
        updateBoardRow.run(name, boardColor, new Date().toISOString(), id, owner);
        return toBoard(boardRow(owner, id));
      });
    },

    deleteBoard(owner: string, id: string): void {
      if (deleteBoardRow.run(id, owner).changes === 0) notFound("board");
    },

    moveBoard(owner: string, id: string, input: unknown): Board[] {
      const afterId = afterIdOf(objectBody(input).afterId);
      return transaction(() => {
        boardRow(owner, id);
        const others = boardRows(owner).filter((b) => b.id !== id);
        setBoardRank.run(
          place(others, afterId, "board", (bid, r) => setBoardRank.run(r, bid)),
          id,
        );
        return boardRows(owner).map(toBoard);
      });
    },

    // ── Lists ────────────────────────────────────────────────────────────────────────────────

    /** A new list at the end of a board. */
    createList(owner: string, input: unknown): List {
      const b = objectBody(input);
      const name = listName(b.name);
      return transaction(() => {
        if (typeof b.boardId !== "string") invalid("boardId must be a board's id");
        const board = boardRow(owner, b.boardId);
        return toList(listRow(owner, addList(owner, board.id, name)));
      });
    },

    updateList(owner: string, id: string, input: unknown): List {
      const name = listName(objectBody(input).name);
      listRow(owner, id);
      updateListName.run(name, new Date().toISOString(), id);
      return toList(listRow(owner, id));
    },

    deleteList(owner: string, id: string): void {
      if (deleteListRow.run(id, owner).changes === 0) notFound("list");
    },

    /** Moves a list along its board. Answers the board's lists in their new order. */
    moveList(owner: string, id: string, input: unknown): List[] {
      const afterId = afterIdOf(objectBody(input).afterId);
      return transaction(() => {
        const list = listRow(owner, id);
        const others = listRows(list.board_id).filter((l) => l.id !== id);
        setListRank.run(
          place(others, afterId, "list", (lid, r) => setListRank.run(r, lid)),
          id,
        );
        return listRows(list.board_id).map(toList);
      });
    },

    // ── Labels ───────────────────────────────────────────────────────────────────────────────

    createLabel(owner: string, input: unknown): Label {
      const b = objectBody(input);
      const name = labelName(b.name);
      const labelColor = color(b.color);
      return transaction(() => {
        if (typeof b.boardId !== "string") invalid("boardId must be a board's id");
        const board = boardRow(owner, b.boardId);
        return toLabel(labelRow(owner, addLabel(owner, board.id, name, labelColor)));
      });
    },

    updateLabel(owner: string, id: string, input: unknown): Label {
      const b = objectBody(input);
      const label = labelRow(owner, id);
      const name = b.name === undefined ? label.name : labelName(b.name);
      const labelColor = b.color === undefined ? label.color : color(b.color);
      updateLabelRow.run(name, labelColor, id);
      return toLabel(labelRow(owner, id));
    },

    deleteLabel(owner: string, id: string): void {
      if (deleteLabelRow.run(id, owner).changes === 0) notFound("label");
    },

    // ── Cards ────────────────────────────────────────────────────────────────────────────────

    /** A new card in a list: after `afterId`, first when it is null, last when it is left out. */
    createCard(owner: string, input: unknown): CardSummary {
      const b = objectBody(input);
      const title = cardTitle(b.title);
      const afterId = b.afterId === undefined ? undefined : afterIdOf(b.afterId);
      return transaction(() => {
        const list = listRow(owner, b.listId);
        checkCardRoom(owner, list.board_id);
        const siblings = listCards(list.id);
        const rank =
          afterId === undefined
            ? rankAtEnd(siblings)
            : place(siblings, afterId, "card", (cid, r) => setCardRank.run(r, cid));
        return summary(addCard(owner, list, rank, { title, description: "", dueDate: null }));
      });
    },

    card(owner: string, id: string): Card {
      return fullCard(cardRow(owner, id));
    },

    /** Changes a card's title, description, due date or labels; 409 if it changed since `rev`. */
    patchCard(owner: string, id: string, input: unknown): Card {
      const b = objectBody(input);
      if (!Number.isInteger(b.rev)) invalid("rev must be the card's revision");
      return transaction(() => {
        const row = cardRow(owner, id);
        if (row.rev !== b.rev) {
          throw new StoreError(409, "The card was changed elsewhere", "conflict", fullCard(row));
        }
        const title = b.title === undefined ? row.title : cardTitle(b.title);
        const desc = b.description === undefined ? row.description : description(b.description);
        const due = b.dueDate === undefined ? row.due_date : dueDate(b.dueDate);
        if (b.labelIds !== undefined) {
          const ids = labelIdsOf(b.labelIds, row.board_id);
          deleteCardLabels.run(id);
          for (const labelId of ids) insertCardLabel.run(id, labelId);
        }
        updateCardFields.run(title, desc, due, newRev(), new Date().toISOString(), id);
        return fullCard(cardRow(owner, id));
      });
    },

    deleteCard(owner: string, id: string): void {
      if (deleteCardRow.run(id, owner).changes === 0) notFound("card");
    },

    /**
     * Puts a card in a list (on this board or another of the owner's) after `afterId`, or first.
     * On another board its labels go to that board's labels of the same name and colour; the
     * others are left behind and counted.
     */
    moveCard(owner: string, id: string, input: unknown): CardMoved {
      const b = objectBody(input);
      const afterId = afterIdOf(b.afterId);
      return transaction(() => {
        const card = cardRow(owner, id);
        const list = listRow(owner, b.listId);
        if (afterId === id) invalid("A card can't follow itself");
        const siblings = listCards(list.id).filter((c) => c.id !== id);
        const rank = place(siblings, afterId, "card", (cid, r) => setCardRank.run(r, cid));
        let droppedLabels = 0;
        let rev = card.rev;
        if (list.board_id !== card.board_id) {
          checkCardRoom(owner, list.board_id);
          const had = new Map(labelRows(card.board_id).map((l) => [l.id, l]));
          const targets = new Map(labelRows(list.board_id).map((l) => [labelKey(l), l.id]));
          const ids = cardLabelIds(id);
          deleteCardLabels.run(id);
          for (const labelId of ids) {
            const target = targets.get(labelKey(had.get(labelId)!));
            if (target) insertCardLabel.run(id, target);
            else droppedLabels++;
          }
          // Its labels changed: an open editor must not write the old ones back.
          rev = newRev();
        }
        setCardPlace.run(list.board_id, list.id, rank, rev, new Date().toISOString(), id);
        return { card: summary(id), droppedLabels };
      });
    },

    // ── Checklist ────────────────────────────────────────────────────────────────────────────

    /** A new item at the end of a card's checklist. */
    createItem(owner: string, cardId: string, input: unknown): ChecklistItem {
      const text = itemText(objectBody(input).text);
      return transaction(() => {
        cardRow(owner, cardId);
        const items = itemRows(cardId);
        if (items.length >= LIMITS.items) tooMany(`At most ${LIMITS.items} checklist items on a card`);
        return toItem(itemRow(owner, addItem(owner, cardId, text, false, rankAtEnd(items))));
      });
    },

    updateItem(owner: string, id: string, input: unknown): ChecklistItem {
      const b = objectBody(input);
      const item = itemRow(owner, id);
      const text = b.text === undefined ? item.text : itemText(b.text);
      if (b.done !== undefined && typeof b.done !== "boolean") invalid("done must be true or false");
      const done = b.done === undefined ? item.done === 1 : b.done;
      updateItemRow.run(text, done ? 1 : 0, id);
      return toItem(itemRow(owner, id));
    },

    deleteItem(owner: string, id: string): void {
      if (deleteItemRow.run(id, owner).changes === 0) notFound("checklist item");
    },

    /** Moves an item within its checklist. Answers the checklist in its new order. */
    moveItem(owner: string, id: string, input: unknown): ChecklistItem[] {
      const afterId = afterIdOf(objectBody(input).afterId);
      return transaction(() => {
        const item = itemRow(owner, id);
        const others = itemRows(item.card_id).filter((i) => i.id !== id);
        setItemRank.run(
          place(others, afterId, "item", (iid, r) => setItemRank.run(r, iid)),
          id,
        );
        return itemRows(item.card_id).map(toItem);
      });
    },

    // ── Backup ───────────────────────────────────────────────────────────────────────────────

    /** Every board of the owner, or one. */
    exportBoards(owner: string, boardId?: string): ExportFile {
      const boards = boardId === undefined ? boardRows(owner) : [boardRow(owner, boardId)];
      return {
        format: "valkyrie",
        version: 1,
        exportedAt: new Date().toISOString(),
        boards: boards.map(exportBoard),
      };
    },

    /**
     * Adds the boards of a backup as new boards (a name that is taken gets " (2)"). Nothing is
     * merged, so restoring a file twice gives two copies. A bad file changes nothing.
     */
    restore(owner: string, input: unknown): RestoreResult {
      const b = objectBody(input);
      if (b.format !== "valkyrie" || b.version !== 1) {
        invalid("This is not a Valkyrie backup (format valkyrie, version 1)");
      }
      if (!Array.isArray(b.boards)) invalid("The file must have a boards list");
      if (b.boards.length > LIMITS.boards) invalid(`At most ${LIMITS.boards} boards`);
      const boards = b.boards.map((value, i) => {
        try {
          return importBoardOf(value);
        } catch (err) {
          if (err instanceof StoreError) invalid(`Board ${i + 1}: ${err.message}`);
          throw err;
        }
      });

      return transaction(() => {
        let cards = 0;
        for (const board of boards) {
          const boardId = addBoard(owner, freeName(owner, board.name), board.color);
          const labelIds = board.labels.map((l) => addLabel(owner, boardId, l.name, l.color));
          for (const list of board.lists) {
            const listId = addList(owner, boardId, list.name);
            const row = listRow(owner, listId);
            const ranks = freshRanks(list.cards.length);
            list.cards.forEach((c, i) => {
              const cardId = addCard(owner, row, ranks[i]!, c);
              for (const n of new Set(c.labels)) insertCardLabel.run(cardId, labelIds[n]!);
              const itemRanks = freshRanks(c.items.length);
              c.items.forEach((item, j) => addItem(owner, cardId, item.text, item.done, itemRanks[j]!));
            });
            cards += list.cards.length;
          }
          checkCardRoom(owner, boardId, 0);
        }
        return { boards: boards.length, cards };
      });
    },

    /**
     * Deletes for good every board (with everything on it) of every owner who isn't in `known`
     * (Heimdall's usernames), i.e. of users removed from Heimdall. Returns how many cards each had.
     */
    removeUnknownOwners(known: ReadonlySet<string>): { owner: string; cards: number }[] {
      const $known = JSON.stringify([...known]);
      return transaction(() => {
        const removed = countUnknownOwners.all({ $known }) as { owner: string; cards: number }[];
        deleteUnknown.run({ $known });
        return removed;
      });
    },
  };
}

export type Store = ReturnType<typeof createStore>;
