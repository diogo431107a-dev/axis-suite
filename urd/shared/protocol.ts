// The API's wire format: what the server sends and accepts, and the limits it enforces.
// Uses no Node or DOM APIs, so both the server and the page import it.

/** Sent with every request: the user the page belongs to. The API answers 409 if someone else is signed in. */
export const USER_HEADER = "X-Urd-User";

export const LIMITS = {
  projectNameChars: 100,
  /** projects per user, archived ones included */
  projects: 1000,
  tagChars: 50,
  tagsPerSession: 20,
  /** days of sessions in one page of history */
  historyDays: 14,
  /** the largest estimate: 100,000 hours */
  estimateSeconds: 100_000 * 3600,
} as const;

/** How a session stopped: the Stop button (or a trim of its end), or by itself at midnight or 05:00. */
export type StopKind = "manual" | "auto";

/** One play/stop cycle. Instants are YYYY-MM-DDTHH:MM:SSZ. */
export interface Session {
  id: string;
  projectId: string | null;
  /** the project's name, or null for a session not named yet */
  project: string | null;
  /** lower case, without #, in the order given */
  tags: string[];
  startedAt: string;
  /** null while it runs */
  endedAt: string | null;
  /** when it stops by itself: the next midnight, or 05:00 for a start at 22:00 or later */
  cutoffAt: string;
  /** the time zone it was started in, which settled `day` and `cutoffAt` */
  zone: string;
  /** YYYY-MM-DD: the date it started; all its time counts for this day */
  day: string;
  /** null while it runs */
  stop: StopKind | null;
  /** its length in whole seconds, up to now while it runs */
  seconds: number;
}

/** Time and interruptions (sessions) over a period. */
export interface Tally {
  seconds: number;
  sessions: number;
}

/** The periods the timer shows, around a day (see TimerState.day). Weeks start on Monday. */
export interface Periods {
  today: Tally;
  week: Tally;
  month: Tally;
  overall: Tally;
}

/** GET /api/state: everything the timer shows. */
export interface TimerState {
  /** the server's clock, so the page can tell how far off its own is */
  now: string;
  /** the day the periods are about: the running session's day, else the page's today */
  day: string;
  running: Session | null;
  /** the session that ended last, if any */
  last: Session | null;
  /** every project together, running session included */
  all: Periods;
  /** the project asked for (?project=), else the running session's; null if neither */
  project: { id: string; name: string; periods: Periods } | null;
  /** sessions without a project */
  unnamed: number;
}

/** A change to a project's estimate. */
export interface EstimateChange {
  at: string;
  /** seconds; null = no estimate */
  from: number | null;
  to: number | null;
}

export interface Project {
  id: string;
  name: string;
  /** seconds; null = no estimate */
  estimate: number | null;
  /** every change to the estimate, oldest first */
  estimateLog: EstimateChange[];
  archived: boolean;
  createdAt: string;
  /** when its latest session started, or null if it has none */
  lastUsedAt: string | null;
  /** around the day asked for (?day=) */
  periods: Periods;
}

/** POST /api/sessions/start */
export interface StartBody {
  /** the browser's IANA time zone, which settles the session's day and automatic stop */
  zone: string;
  /** a project's name (found ignoring case, or made); null or "" = none yet */
  project?: string | null;
  tags?: string[];
}

/**
 * PATCH /api/sessions/:id: only the fields present change. Times can only shorten a session:
 * startedAt may move later, endedAt earlier. endedAt on a running session stops it at that time.
 */
export interface SessionPatch {
  project?: string | null;
  tags?: string[];
  startedAt?: string;
  endedAt?: string;
}

/** PATCH /api/projects/:id: only the fields present change. */
export interface ProjectPatch {
  /** another project's name answers 409 { code: "exists" }, unless merge is true */
  name?: string;
  /** with a name another project has: move this one's sessions there, and delete this one */
  merge?: boolean;
  archived?: boolean;
  /** seconds, or null for none */
  estimate?: number | null;
}

/** GET /api/sessions: days of sessions, newest first. */
export interface HistoryPage {
  sessions: Session[];
  /** pass as ?before= for the next page; null when there are no older days */
  next: string | null;
}

export interface TagCount {
  tag: string;
  count: number;
}

export type ErrorCode = "invalid" | "not-found" | "exists" | "not-running" | "not-empty" | "too-many" | "other-user";

/** Every error answer: a sentence for people and, for the ones a page reacts to, a code. */
export interface ApiError {
  error: string;
  code?: ErrorCode;
}

/** Live updates (GET /api/events). "changed": this user's sessions or projects changed; ask again. */
export interface EventMap {
  changed: Record<string, never>;
}
