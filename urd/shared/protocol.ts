// The API's wire format: what the server sends and accepts, and the limits it enforces.
// Uses no Node or DOM APIs, so both the server and the page import it.

/** Sent with every request: the user the page belongs to. The API answers 409 if someone else is signed in. */
export const USER_HEADER = "X-Urd-User";

export const LIMITS = {
  projectNameChars: 100,
  taskNameChars: 200,
  /** projects per user, archived ones included */
  projects: 1000,
  tagChars: 50,
  tagsPerSession: 20,
  /** days of sessions in one page of history */
  historyDays: 14,
  /** the largest estimate: 100,000 hours */
  estimateSeconds: 100_000 * 3600,
} as const;

/**
 * How a session stopped: the Stop button (or a trim of its end). "auto" is only on sessions from
 * before Urd 2.0.0, which stopped by themselves at midnight or 05:00; nothing stops one by itself now.
 */
export type StopKind = "manual" | "auto";

/** One play/stop cycle. Instants are YYYY-MM-DDTHH:MM:SSZ. */
export interface Session {
  id: string;
  projectId: string | null;
  /** the project's name, or null for none */
  project: string | null;
  /** the task's name, or null for none; a session with neither project nor task is "unnamed" */
  task: string | null;
  /** lower case, without #, in the order given */
  tags: string[];
  startedAt: string;
  /** null while it runs */
  endedAt: string | null;
  /** the time zone it was started in, whose midnights split its time between days */
  zone: string;
  /** YYYY-MM-DD: the date it started there (see shared/days.ts for the days it has time in) */
  day: string;
  /** null while it runs */
  stop: StopKind | null;
  /** its length in whole seconds, up to now while it runs */
  seconds: number;
}

/**
 * Time and interruptions (sessions) over a period. A session that runs past midnight counts in
 * every period it has time in, with the part of its time that fell there.
 */
export interface Tally {
  seconds: number;
  sessions: number;
  /** the longest uninterrupted work: the longest session's part in the period, in seconds */
  longest: number;
}

/** The periods the timer shows, around a day (TimerState.day). Weeks start on Monday. */
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
  /** the day the periods are about: the page's today */
  day: string;
  running: Session | null;
  /** the session that ended last, if any */
  last: Session | null;
  /** every project together, running session included */
  all: Periods;
  /** the project asked for (?project=), else the running session's; null if neither */
  project: { id: string; name: string; periods: Periods } | null;
  /** the task asked for (?task=, in ?project= or in none), else the running session's; null if neither */
  task: { projectId: string | null; name: string; periods: Periods } | null;
  /** sessions with neither a project nor a task */
  unnamed: number;
}

/**
 * GET /api/tasks: a task, the sessions of a project (or of none) with the same task name. Each
 * project also has a "task" without a name: its sessions without a task.
 */
export interface Task {
  projectId: string | null;
  /** the project's name, null for none */
  project: string | null;
  /** null: the sessions without a task */
  name: string | null;
  firstStartedAt: string;
  lastStartedAt: string;
  /** the tags of its latest session, for resuming it */
  lastTags: string[];
  /** around the day asked for (?day=) */
  periods: Periods;
}

/**
 * PATCH /api/tasks: renames a task (or names a project's sessions without one), or moves it to
 * another project. A name the target has already puts the two together.
 */
export interface TaskPatch {
  /** the task: its project's id (null: none) and its name (null: the sessions without a task) */
  projectId: string | null;
  name: string | null;
  /** the new name; null or "" for none */
  rename?: string | null;
  /** the project's name to move it to; null or "" for none */
  project?: string | null;
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
  /** the browser's IANA time zone, whose midnights split the session's time between days */
  zone: string;
  /** a project's name (found ignoring case, or made); null or "" = none yet */
  project?: string | null;
  /** a task's name, in that project (found ignoring case); null or "" = none */
  task?: string | null;
  tags?: string[];
  /** while a session runs: stop it and start this one, rather than answering the running one */
  switch?: boolean;
}

/**
 * PATCH /api/sessions/:id: only the fields present change. Times can only shorten a session:
 * startedAt may move later, endedAt earlier. endedAt on a running session stops it at that time.
 */
export interface SessionPatch {
  project?: string | null;
  task?: string | null;
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
  /** the days shown, newest first */
  days: string[];
  /** every session with time in those days, newest first; one past midnight is on each of its days */
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
