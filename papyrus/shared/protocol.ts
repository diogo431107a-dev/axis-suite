// The API's wire format: what the server sends and accepts, and the limits it enforces.
// Uses no Node or DOM APIs, so both the server and the page import it.

/** Sent with every request: the user the page belongs to. The API answers 409 if someone else is signed in. */
export const USER_HEADER = "X-Papyrus-User";

export const LIMITS = {
  pageChars: 200_000,
  journalNameChars: 100,
  /** journals per user, recycle bin included */
  journals: 100,
  templateNameChars: 100,
  templateChars: 20_000,
  templates: 200,
  prompts: 1000,
  promptChars: 500,
  tagChars: 100,
  tagsPerPage: 200,
  queryChars: 500,
  /** results of one search; the answer says if there were more */
  searchResults: 200,
  /** days in one GET /api/days */
  dayRange: 400,
  /** pages in one import */
  importPages: 100_000,
} as const;

/** How long a deleted journal stays in the recycle bin. */
export const BIN_DAYS = 30;

/** The colours a journal can have. The page maps each to fixed Tailwind classes. */
export const COLORS = ["amber", "rose", "emerald", "sky", "violet", "teal", "orange", "stone"] as const;
export type Color = (typeof COLORS)[number];

export type Mood = 1 | 2 | 3 | 4 | 5;
export const MOOD_NAMES: Record<Mood, string> = { 1: "Awful", 2: "Bad", 3: "Okay", 4: "Good", 5: "Great" };

/** 0 = Sunday, 1 = Monday, 6 = Saturday; null = the browser's custom, else Monday. */
export type WeekStart = 0 | 1 | 6 | null;

export interface Journal {
  id: string;
  name: string;
  color: Color;
  /** the template offered first on an empty page */
  templateId: string | null;
  /** pages written in it */
  pages: number;
  createdAt: string;
  updatedAt: string;
  /** set while the journal is in the recycle bin */
  deletedAt: string | null;
}

/** POST /api/journals */
export interface JournalCreate {
  name: string;
  color?: Color;
}

/** PATCH /api/journals/:id: only the fields present change. */
export interface JournalPatch {
  name?: string;
  color?: Color;
  templateId?: string | null;
}

/**
 * One day's page. A day nobody wrote in has rev 0, empty text and no mood; a page is never stored
 * empty (no text and no mood), so emptying one deletes it.
 */
export interface Page {
  journalId: string;
  date: string;
  text: string;
  mood: Mood | null;
  tags: string[];
  words: number;
  /** changes with every save (from one counter for the whole database); 0 = no page */
  rev: number;
  updatedAt: string | null;
}

/** PUT /api/pages/:journalId/:date */
export interface PageWrite {
  text: string;
  mood: Mood | null;
  /** the rev the page edited (0: no page yet). 409 { code: "conflict", page } if it changed since. */
  rev: number;
}

/** PUT /api/pages/:journalId/:date answers this, without the text. rev 0: the page is empty now, so it isn't stored. */
export interface PageSaved {
  rev: number;
  words: number;
  tags: string[];
  updatedAt: string | null;
}

/** A page as calendars list it (GET /api/days), and "On this day" (GET /api/on-this-day). */
export interface DaySummary {
  journalId: string;
  date: string;
  mood: Mood | null;
  words: number;
  tags: string[];
  /** the start of the text, on one line */
  preview: string;
}

/** GET /api/streak */
export interface Streak {
  /** days in a row with a page, ending today or yesterday; 0 if neither has one */
  days: number;
}

export interface TagCount {
  tag: string;
  count: number;
}

/** GET /api/search */
export interface SearchAnswer {
  hits: SearchHit[];
  /** there were more than LIMITS.searchResults */
  more: boolean;
}

export interface SearchHit {
  journalId: string;
  date: string;
  mood: Mood | null;
  /** part of the text around the first match, on one line */
  snippet: string;
  /** [start, end) of each match in the snippet */
  marks: [number, number][];
}

export interface Template {
  id: string;
  name: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

/** POST /api/templates; PATCH takes any of the two. */
export interface TemplateFields {
  name: string;
  text: string;
}

export interface Settings {
  /** the user's own writing prompts; null = the built-in ones */
  prompts: string[] | null;
  weekStart: WeekStart;
}

export type ErrorCode = "invalid" | "not-found" | "conflict" | "exists" | "too-many" | "not-in-bin" | "other-user";

/** Every error answer: a sentence for people and, for the ones a page reacts to, a code. */
export interface ApiError {
  error: string;
  code?: ErrorCode;
  /** with "conflict": the page as it is now */
  page?: Page;
}

/** GET /api/export, POST /api/import: every journal (recycle bin left out), templates and settings. */
export interface ExportFile {
  format: "papyrus";
  version: 1;
  exportedAt: string;
  journals: ExportJournal[];
  templates: TemplateFields[];
  settings: Settings;
}

export interface ExportJournal {
  name: string;
  color: Color;
  /** name of its default template, or null */
  template: string | null;
  pages: ExportPage[];
}

export interface ExportPage {
  date: string;
  text: string;
  mood: Mood | null;
  createdAt: string;
  updatedAt: string;
}

/** POST /api/import answers what it did. */
export interface ImportResult {
  /** journals made (the others were matched by name) */
  journals: number;
  templates: number;
  /** pages for days that had none */
  pages: number;
  /** pages added to one already there */
  merged: number;
  /** pages already there (the same text, or a part of it) */
  skipped: number;
}
