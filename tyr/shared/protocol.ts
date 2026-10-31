// The API's wire format, used by the server and the page.

/** A page names the user whose files it shows, so its changes can't land in someone else's drawer. */
export const USER_HEADER = "X-Tyr-User";

export const LIMITS = {
  name: 60,
  aliases: 5,
  role: 120,
  matters: 5,
  matter: 120,
  note: 300,
  placeLabel: 80,
  city: 60,
  body: 2000,
  context: 120,
  present: 20,
  answer: 2000,
  evidence: 100,
  title: 120,
  mentions: 20,
  files: 5000,
  places: 2000,
  entries: 100_000,
} as const;

/** Who the words come from, and how I came by them. */
export const SOURCES = ["U", "I", "P", "O", "N"] as const;
export type Source = (typeof SOURCES)[number];

export const SETTINGS = ["private", "group"] as const;
export type Setting = (typeof SETTINGS)[number];

export const WORDINGS = ["para", "quote"] as const;
export type Wording = (typeof WORDINGS)[number];

export const CERTAINTIES = ["sure", "fair", "fuzzy"] as const;
export type Certainty = (typeof CERTAINTIES)[number];

/** Rough parts of the day, for when the hour isn't known. */
export const BANDS = ["morning", "afternoon", "evening", "night"] as const;
export type Band = (typeof BANDS)[number];

export const PRECISIONS = ["date", "month", "year", "around"] as const;
export type Precision = (typeof PRECISIONS)[number];

/** The profile's questions: key, label, a small note. Entries are filed under one of the keys. */
export const QUESTIONS = [
  ["drives", "What drives them", "deep, lasting"],
  ["wants", "What they want right now", "concrete"],
  ["values", "What matters to them", "values"],
  ["fears", "What they fear", ""],
  ["self", "How they see themselves", ""],
  ["others", "How they treat others", "close and distant"],
  ["shaped", "What shaped them", ""],
  ["stress", "Under stress, confused, at their best", ""],
  ["contra", "Where they contradict themselves", ""],
  ["joy", "What makes them happy", "small pleasures and big joys"],
  ["likes", "What they enjoy", "food, music, humour, gift ideas"],
  ["irks", "What irritates or bores them", "pet peeves"],
  ["treat", "How they like to be treated", "directness, space, how to address them"],
  ["hopes", "What they hope for from me", ""],
  ["chapter", "What chapter they are in", "ongoing situations"],
  ["rhythms", "When and where they are around", ""],
] as const;
export type Question = (typeof QUESTIONS)[number][0];
export const QUESTION_KEYS: readonly string[] = QUESTIONS.map((q) => q[0]);

/**
 * A moment as it was typed, in the user's own calendar and clock, never converted.
 * `d` is YYYY-MM-DD (precision "date"), YYYY-MM ("month") or YYYY ("year", "around").
 * `t` is HH:MM, a band, or null; only an exact date can have one.
 */
export interface Stamp {
  d: string;
  t: string | null;
  p: Precision;
}

export interface Person {
  id: string;
  /** The file's number: TYR-0001. Never used twice in a drawer. */
  no: number;
  name: string;
  aliases: string[];
  role: string;
  matters: string[];
  opened: string;
  closed: string | null;
  closeNote: string;
}

export interface Place {
  id: string;
  label: string;
  city: string;
}

export interface FollowUp {
  date: string;
  note: string;
  /** The day it was marked done. */
  done: string | null;
}

export interface Entry {
  id: string;
  person: string;
  /** When it was typed: an instant set by the server, which never changes. */
  logged: string;
  told: Stamp;
  hap: Stamp;
  place: string | null;
  setting: Setting | null;
  src: Source;
  wording: Wording;
  body: string;
  cat: Question | null;
  cert: Certainty;
  /** They asked me not to repeat it. */
  conf: boolean;
  present: string[];
  ctx: string;
  fu: FollowUp | null;
  amends: string | null;
  contra: string | null;
  incomplete: boolean;
  /** To their credit: shown beside any open concern, so a file isn't only a case file. */
  credit: boolean;
  incident: string | null;
}

/** One version of a profile answer. The latest for a question is the answer. */
export interface Answer {
  id: string;
  person: string;
  q: Question;
  text: string;
  ev: string[];
  revised: string;
}

export const CARE_LEVELS = ["never", "careful", "ifthey", "practical", "watch", "welcome"] as const;
export type CareLevel = (typeof CARE_LEVELS)[number];

/** An instruction in my words: what to do, not the story behind it. */
export interface CareNote {
  id: string;
  person: string;
  level: CareLevel;
  text: string;
  /** A day of the year that is hard for them, MM-DD. */
  date: string | null;
  since: string;
  source: string | null;
  confirmed: string;
  retired: string | null;
}

export const OUTCOMES = ["pending", "kept", "broken", "released"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export interface WordGiven {
  id: string;
  person: string;
  /** Who gave their word. */
  dir: "me" | "they";
  words: string;
  made: string;
  due: string | null;
  outcome: Outcome;
  outcomeOn: string | null;
  source: string | null;
}

export const CONCERN_STATES = ["open", "dismissed", "breach"] as const;
export type ConcernState = (typeof CONCERN_STATES)[number];

export interface Concern {
  id: string;
  person: string;
  text: string;
  opened: string;
  review: string;
  state: ConcernState;
  ev: string[];
  reviewNote: string;
  reviewed: string | null;
}

/** Where I read them wrong. */
export interface Correction {
  id: string;
  person: string;
  on: string;
  text: string;
  entry: string | null;
}

/** Hearsay: what someone told me, not what I heard or saw. Never an entry, and never changed. */
export interface Hearsay {
  id: string;
  logged: string;
  told: Stamp;
  hap: Stamp;
  place: string | null;
  text: string;
  /** Who told me. Not to be revealed. */
  by: string;
}

/** A report of what someone said about me to others. In the file of whoever reportedly said it. */
export interface Report extends Hearsay {
  person: string;
}

export const INCIDENT_STATUSES = ["rumour", "one", "confirmed", "disproved"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** Something bigger than one entry. Its entries point to it; only hearsay is kept in it. */
export interface Incident {
  id: string;
  title: string;
  status: IncidentStatus;
  people: string[];
  /** People with no file of their own, in a few words. */
  mentions: string[];
  opened: string;
  closed: string | null;
  closeNote: string;
  history: { on: string; status: IncidentStatus }[];
  notes: Hearsay[];
}

/** Everything in a user's drawer. Answers come oldest first. */
export interface Dossier {
  people: Person[];
  places: Place[];
  entries: Entry[];
  answers: Answer[];
  care: CareNote[];
  words: WordGiven[];
  concerns: Concern[];
  corrections: Correction[];
  reports: Report[];
  incidents: Incident[];
}

/** What can be said about an entry when it is written or completed. */
export interface EntryFields {
  told: Stamp;
  hap: Stamp;
  /** A place's label: the place is found, or added to the list. */
  place: string | null;
  setting: Setting | null;
  src: Source;
  wording: Wording;
  body: string;
  cat: Question | null;
  cert: Certainty;
  conf: boolean;
  present: string[];
  ctx: string;
  fu: { date: string; note: string } | null;
  contra: string | null;
  credit: boolean;
  incident: string | null;
}

export interface NewEntry extends EntryFields {
  id: string;
  person: string;
  amends: string | null;
  incomplete: boolean;
  /** Muninn's !care: the entry's words also become a care note. */
  care?: boolean;
}

/** Just met: the file and its first entry together. */
export interface NewFile {
  id: string;
  name: string;
  role: string;
  opened: string;
  entry: Omit<NewEntry, "person" | "amends" | "care">;
}

export interface FileChange {
  name?: string;
  aliases?: string[];
  role?: string;
  matters?: string[];
  /** Closes the file, or with null opens it again. */
  closed?: { on: string; note: string } | null;
}

/** Filing an entry, which doesn't touch what it says. */
export interface EntryFiling {
  cat?: Question | null;
  /** The day a follow-up was done, or null if it wasn't after all. */
  fuDone?: string | null;
  credit?: boolean;
  incident?: string | null;
}

export interface NewAnswer {
  id: string;
  person: string;
  q: Question;
  text: string;
  ev: string[];
  revised: string;
}

export interface NewPlace {
  label: string;
  city: string;
}

export type ErrorCode = "invalid" | "not-found" | "too-many" | "conflict" | "other-user";

export interface ApiError {
  error: string;
  code?: ErrorCode;
}
