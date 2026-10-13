// The API's wire format: what the server sends and accepts, and the limits it enforces.
// Uses no Node or DOM APIs, so both the server and the page import it.
//
// Times: a timed event starts and ends at instants, written in UTC as YYYY-MM-DDTHH:MM:SSZ. An
// all-day event starts and ends on dates, YYYY-MM-DD, with the end exclusive as in iCalendar (a
// one-day event on 2026-11-08 ends 2026-11-09); dates have no time zone, so they never move.

/** Sent with every request: the user the page belongs to. The API answers 409 if someone else is signed in. */
export const USER_HEADER = "X-Chronos-User";

export const LIMITS = {
  calendars: 50,
  calendarNameChars: 100,
  titleChars: 500,
  locationChars: 500,
  urlChars: 2000,
  descriptionChars: 20_000,
  /** events per user, every calendar together */
  events: 100_000,
  /** events in one import */
  importEvents: 30_000,
  /** days one GET /api/events may span */
  rangeDays: 800,
} as const;

/** Repeating events in an imported file become plain events from this many years back to this many ahead. */
export const EXPAND = { yearsBack: 2, yearsAhead: 5, perEvent: 500 } as const;

/** The colours a calendar can have. The page maps each to fixed Tailwind classes. */
export const COLORS = [
  "indigo",
  "sky",
  "teal",
  "emerald",
  "lime",
  "amber",
  "orange",
  "rose",
  "fuchsia",
  "stone",
] as const;
export type Color = (typeof COLORS)[number];

export interface Calendar {
  id: string;
  name: string;
  color: Color;
  /** hidden calendars keep their events, the page just doesn't show them */
  visible: boolean;
  position: number;
  /** the file it was last imported from, or null */
  sourceName: string | null;
  importedAt: string | null;
  /** how many events it has */
  events: number;
}

/** POST /api/calendars; PATCH takes any of them. */
export interface CalendarFields {
  name: string;
  color: Color;
  visible?: boolean;
}

/** What an event holds, as the editor sends it (POST, and PUT with rev). */
export interface EventFields {
  calendarId: string;
  title: string;
  allDay: boolean;
  /** an instant (YYYY-MM-DDTHH:MM:SSZ), or a date when allDay */
  start: string;
  /** an instant at or after start, or a date after start (exclusive) when allDay */
  end: string;
  location: string;
  description: string;
  /** http:// or https:// only, or "" */
  url: string;
}

export interface CalEvent extends EventFields {
  id: string;
  /** iCalendar's UID; with recurrenceId, what a re-import matches on */
  uid: string;
  /** "" for a single event; for one occurrence of a repeating event in an imported file, its original start */
  recurrenceId: string;
  /** made here, or imported from a file */
  origin: "user" | "import";
  /** the time zone the file gave it (IANA, or UTC+HH:MM), or null */
  sourceZone: string | null;
  /** changes with every save (from one counter for the whole database) */
  rev: number;
  createdAt: string;
  updatedAt: string;
}

/** PUT /api/events/:id */
export interface EventWrite extends EventFields {
  /** the rev the editor started from. 409 { code: "conflict", event } if it changed since. */
  rev: number;
}

/** POST and PUT /api/events answer this. */
export interface EventSaved {
  id: string;
  rev: number;
  updatedAt: string;
}

export interface Settings {
  /** IANA time zone every time is shown in; "" until the page first sets it (from the browser's) */
  homeZone: string;
  /** where new events go; null: the first calendar */
  defaultCalendarId: string | null;
  /** minutes a new timed event lasts */
  defaultDuration: number;
}

export const DEFAULT_SETTINGS: Settings = { homeZone: "", defaultCalendarId: null, defaultDuration: 60 };

/** An event as an import sends it: read from an .ics file by the page, or from a backup. */
export interface ImportEvent {
  uid: string;
  recurrenceId: string;
  title: string;
  allDay: boolean;
  start: string;
  end: string;
  sourceZone: string | null;
  location: string;
  description: string;
  url: string;
}

/** POST /api/import: the events of one file, into one calendar (an existing one, or a new one). */
export interface ImportRequest {
  calendarId?: string;
  newCalendar?: { name: string; color?: Color };
  /** the file's name, remembered on the calendar */
  sourceName: string;
  /** also delete the calendar's imported events that aren't in the file (events made here stay) */
  removeMissing: boolean;
  events: ImportEvent[];
}

/** POST /api/import answers what it did. */
export interface ImportResult {
  calendarId: string;
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
}

/** GET /api/export, POST /api/restore: every calendar with its events, and the settings. */
export interface ExportFile {
  format: "chronos";
  version: 1;
  exportedAt: string;
  calendars: ExportCalendar[];
  settings?: Settings;
}

export interface ExportCalendar {
  name: string;
  color: Color;
  visible: boolean;
  events: (ImportEvent & { origin: "user" | "import" })[];
}

/** POST /api/restore answers what it did. */
export interface RestoreResult {
  calendars: number;
  added: number;
  updated: number;
  unchanged: number;
}

export type ErrorCode = "invalid" | "not-found" | "conflict" | "exists" | "too-many" | "other-user";

/** Every error answer: a sentence for people and, for the ones a page reacts to, a code. */
export interface ApiError {
  error: string;
  code?: ErrorCode;
  /** with "conflict": the event as it is now */
  event?: CalEvent;
}
