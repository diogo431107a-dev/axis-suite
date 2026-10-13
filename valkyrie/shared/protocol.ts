// The API's wire format: what the server sends and accepts, and the limits it enforces.
// Uses no Node or DOM APIs, so both the server and the page import it.
//
// Order: boards, lists, cards and checklist items come in the order they are shown. A move names
// the item it goes after (null: first), never a position number, so the server alone decides how
// the order is stored.

/** Sent with every request: the user the page belongs to. The API answers 409 if someone else is signed in. */
export const USER_HEADER = "X-Valkyrie-User";

export const LIMITS = {
  boards: 100,
  /** lists on one board */
  lists: 50,
  /** cards on one board */
  boardCards: 5_000,
  /** cards per user, every board together */
  cards: 50_000,
  /** labels on one board */
  labels: 30,
  /** checklist items on one card */
  items: 200,
  /** board, list and label names */
  nameChars: 100,
  titleChars: 500,
  descriptionChars: 20_000,
  itemChars: 500,
} as const;

/** The colours a board or a label can have. The page maps each to fixed Tailwind classes. */
export const COLORS = ["green", "yellow", "orange", "red", "purple", "blue", "sky", "teal", "pink", "stone"] as const;
export type Color = (typeof COLORS)[number];

/** The lists and labels a new board starts with, unless it is made empty. */
export const TEMPLATE = {
  lists: ["To do", "Doing", "Done"],
  labels: ["green", "yellow", "orange", "red", "purple", "blue"] as Color[],
} as const;

export interface Board {
  id: string;
  name: string;
  color: Color;
  /** how many cards it has */
  cards: number;
}

/** POST /api/boards; PATCH takes either field. */
export interface BoardFields {
  name: string;
  color: Color;
}

export interface NewBoard extends BoardFields {
  /** start with To do / Doing / Done and six labels (default), or empty */
  template?: boolean;
}

export interface List {
  id: string;
  name: string;
}

export interface Label {
  id: string;
  /** may be "": a label can be just a colour */
  name: string;
  color: Color;
}

/** A card as the board shows it. */
export interface CardSummary {
  id: string;
  listId: string;
  title: string;
  /** in the board's label order */
  labelIds: string[];
  /** YYYY-MM-DD, or null */
  dueDate: string | null;
  hasDescription: boolean;
  checklist: { done: number; total: number };
  rev: number;
}

/** GET /api/boards/:id: the whole board, everything in the order shown. */
export interface BoardData {
  board: Board;
  lists: List[];
  labels: Label[];
  /** grouped by list, in list order, each list's cards in order */
  cards: CardSummary[];
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

/** GET /api/cards/:id: a card with everything on it. */
export interface Card {
  id: string;
  boardId: string;
  listId: string;
  title: string;
  description: string;
  dueDate: string | null;
  labelIds: string[];
  items: ChecklistItem[];
  /** changes with every edit of the fields above (from one counter for the whole database) */
  rev: number;
  createdAt: string;
  updatedAt: string;
}

/** PATCH /api/cards/:id: the rev the page started from, and the fields that change. */
export interface CardPatch {
  /** 409 { code: "conflict", card } if the card changed since */
  rev: number;
  title?: string;
  description?: string;
  dueDate?: string | null;
  labelIds?: string[];
}

/** POST /api/cards */
export interface NewCard {
  listId: string;
  title: string;
  /** the card it goes after; null: first; left out: last */
  afterId?: string | null;
}

/** POST /api/cards/:id/move. The list may be on another board (of the same user). */
export interface CardMove {
  listId: string;
  /** the card it goes after in that list; null: first */
  afterId: string | null;
}

/** POST /api/cards/:id/move answers this. */
export interface CardMoved {
  card: CardSummary;
  /** labels left behind because the other board has none with the same name and colour */
  droppedLabels: number;
}

/** POST /api/boards/:id/move, /api/lists/:id/move, /api/items/:id/move */
export interface Move {
  afterId: string | null;
}

/** GET /api/export, GET /api/boards/:id/export, POST /api/restore. */
export interface ExportFile {
  format: "valkyrie";
  version: 1;
  exportedAt: string;
  boards: ExportBoard[];
}

export interface ExportBoard {
  name: string;
  color: Color;
  labels: { name: string; color: Color }[];
  lists: { name: string; cards: ExportCard[] }[];
}

export interface ExportCard {
  title: string;
  description: string;
  dueDate: string | null;
  /** indexes into the board's labels */
  labels: number[];
  items: { text: string; done: boolean }[];
}

/** POST /api/restore answers what it added. */
export interface RestoreResult {
  boards: number;
  cards: number;
}

export type ErrorCode = "invalid" | "not-found" | "conflict" | "exists" | "too-many" | "other-user";

/** Every error answer: a sentence for people and, for the ones a page reacts to, a code. */
export interface ApiError {
  error: string;
  code?: ErrorCode;
  /** with "conflict": the card as it is now */
  card?: Card;
}
