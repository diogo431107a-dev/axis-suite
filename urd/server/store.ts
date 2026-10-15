import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { sessionBounds } from "../shared/cutoff.ts";
import { addDays, isDate, monthOf, pad, weekStart } from "../shared/dates.ts";
import {
  LIMITS,
  type ErrorCode,
  type EstimateChange,
  type HistoryPage,
  type Periods,
  type Project,
  type Session,
  type StopKind,
  type TagCount,
  type TimerState,
} from "../shared/protocol.ts";
import { instantOf, isInstant, msOf, toWall, zoneName } from "../shared/zones.ts";

// The only place sessions and projects are read and written. Every query names the owner (a
// Heimdall username), so nobody reaches another user's data; a row that belongs to someone else
// answers exactly like one that doesn't exist.
//
// A running session needs nothing to happen for its numbers to be right: its time is counted up to
// now or its automatic stop, whichever comes first. closeExpired() then writes the stop down.

/** A request the store refuses, with the HTTP status to answer. */
export class StoreError extends Error {
  readonly status: number;
  readonly code: ErrorCode | undefined;
  constructor(status: number, message: string, code?: ErrorCode) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface SessionRow {
  id: string;
  owner: string;
  project_id: string | null;
  project_name: string | null;
  started_at: number;
  ended_at: number | null;
  cutoff_at: number;
  zone: string;
  day: string;
  stop: StopKind | null;
  /** JSON array, from json_group_array */
  tags: string;
}

interface ProjectRow {
  id: string;
  owner: string;
  name: string;
  estimate_s: number | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  last_used: number | null;
}

interface PeriodRow {
  project_id?: string | null;
  today_s: number;
  today_n: number;
  week_s: number;
  week_n: number;
  month_s: number;
  month_n: number;
  overall_s: number;
  overall_n: number;
}

interface ChangeRow {
  project_id: string;
  at: number;
  from_s: number | null;
  to_s: number | null;
}

function invalid(message: string): never {
  throw new StoreError(400, message, "invalid");
}

const notFound = (what: string): never => {
  throw new StoreError(404, `There is no such ${what}`, "not-found");
};

function objectBody(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    invalid("The request body must be a JSON object");
  }
  return input as Record<string, unknown>;
}

/** A project's name as given, trimmed; null for none ("" or null). */
function projectName(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") invalid("The project must be a name");
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length > LIMITS.projectNameChars)
    invalid(`A project's name has at most ${LIMITS.projectNameChars} characters`);
  return name || null;
}

/** Tags in lower case, without # or repeats, in the order given. */
function tagList(value: unknown): string[] {
  if (!Array.isArray(value)) invalid("The tags must be a list");
  const tags: string[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== "string") invalid("A tag must be text");
    const tag = item.trim().replace(/^#+/, "").replace(/\s+/g, " ").toLowerCase();
    if (!tag) continue;
    if (tag.length > LIMITS.tagChars) invalid(`A tag has at most ${LIMITS.tagChars} characters`);
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > LIMITS.tagsPerSession) invalid(`A session has at most ${LIMITS.tagsPerSession} tags`);
  return tags;
}

/** An instant from the page, as whole seconds since 1970. */
function seconds(value: unknown, name: string): number {
  if (!isInstant(value)) invalid(`${name} must be a time written YYYY-MM-DDTHH:MM:SSZ`);
  return msOf(value) / 1000;
}

const iso = (s: number) => instantOf(s * 1000);

/** A CSV field: quoted when it has to be, and never read as a formula by a spreadsheet. */
function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** A session's time on the wall clock where it was started: "2026-10-15 09:12:03". */
function wallText(s: number, zone: string): string {
  const w = toWall(s * 1000, zone);
  return `${w.date} ${w.time}:${pad(w.second)}`;
}

export function createStore(db: DatabaseSync, clock: () => number = Date.now) {
  const nowS = () => Math.floor(clock() / 1000);
  const nowIso = () => new Date(clock()).toISOString();

  // A session's seconds: up to now while it runs, and never past its automatic stop.
  const SECS = "max(0, min(coalesce(ended_at, $now), cutoff_at) - started_at)";
  // Time and sessions for the day $day, its week ($week_from–$week_to), its month ($month), and ever.
  const PERIOD_COLUMNS = `
    coalesce(sum(CASE WHEN day = $day THEN ${SECS} END), 0) AS today_s,
    count(CASE WHEN day = $day THEN 1 END) AS today_n,
    coalesce(sum(CASE WHEN day BETWEEN $week_from AND $week_to THEN ${SECS} END), 0) AS week_s,
    count(CASE WHEN day BETWEEN $week_from AND $week_to THEN 1 END) AS week_n,
    coalesce(sum(CASE WHEN substr(day, 1, 7) = $month THEN ${SECS} END), 0) AS month_s,
    count(CASE WHEN substr(day, 1, 7) = $month THEN 1 END) AS month_n,
    coalesce(sum(${SECS}), 0) AS overall_s,
    count(*) AS overall_n`;

  const SESSION_SELECT = `
    SELECT s.*, p.name AS project_name,
      (SELECT json_group_array(tag) FROM
        (SELECT tag FROM session_tags t WHERE t.session_id = s.id ORDER BY position)) AS tags
    FROM sessions s LEFT JOIN projects p ON p.id = s.project_id`;

  const selectSession = db.prepare(`${SESSION_SELECT} WHERE s.id = ? AND s.owner = ?`);
  const selectRunning = db.prepare(`${SESSION_SELECT} WHERE s.owner = ? AND s.ended_at IS NULL`);
  const selectLast = db.prepare(
    `${SESSION_SELECT} WHERE s.owner = ? AND s.ended_at IS NOT NULL ORDER BY s.started_at DESC LIMIT 1`,
  );
  const selectHistoryDays = db.prepare(`
    SELECT DISTINCT day FROM sessions
    WHERE owner = $owner AND day < $before
      AND ($unnamed = 0 OR project_id IS NULL) AND ($project IS NULL OR project_id = $project)
    ORDER BY day DESC LIMIT $limit`);
  const selectHistory = db.prepare(`
    ${SESSION_SELECT}
    WHERE s.owner = $owner AND s.day BETWEEN $from AND $to
      AND ($unnamed = 0 OR s.project_id IS NULL) AND ($project IS NULL OR s.project_id = $project)
    ORDER BY s.started_at DESC`);
  const selectAllSessions = db.prepare(`${SESSION_SELECT} WHERE s.owner = ? ORDER BY s.started_at`);
  const countUnnamed = db.prepare("SELECT count(*) AS n FROM sessions WHERE owner = ? AND project_id IS NULL");
  const insertSession = db.prepare(
    `INSERT INTO sessions (id, owner, project_id, started_at, cutoff_at, zone, day, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateSessionRow = db.prepare(
    `UPDATE sessions SET project_id = ?, started_at = ?, ended_at = ?, stop = ?, updated_at = ?
     WHERE id = ? AND owner = ?`,
  );
  const deleteSessionRow = db.prepare("DELETE FROM sessions WHERE id = ? AND owner = ? RETURNING project_id");
  const expireRunning = db.prepare(
    `UPDATE sessions SET ended_at = cutoff_at, stop = 'auto', updated_at = ?
     WHERE ended_at IS NULL AND cutoff_at <= ? RETURNING owner`,
  );
  const deleteTags = db.prepare("DELETE FROM session_tags WHERE session_id = ?");
  const insertTag = db.prepare("INSERT INTO session_tags (session_id, position, tag) VALUES (?, ?, ?)");
  const selectTags = db.prepare(`
    SELECT t.tag, count(*) AS count FROM session_tags t JOIN sessions s ON s.id = t.session_id
    WHERE s.owner = ? GROUP BY t.tag ORDER BY count DESC, t.tag LIMIT 500`);

  const selectPeriods = db.prepare(`
    SELECT ${PERIOD_COLUMNS} FROM sessions
    WHERE owner = $owner AND ($project IS NULL OR project_id = $project)`);
  const selectProjectPeriods = db.prepare(`
    SELECT project_id, ${PERIOD_COLUMNS} FROM sessions
    WHERE owner = $owner AND project_id IS NOT NULL GROUP BY project_id`);

  const PROJECT_SELECT = `
    SELECT p.*, (SELECT max(started_at) FROM sessions s WHERE s.project_id = p.id) AS last_used
    FROM projects p`;
  const selectProjects = db.prepare(`${PROJECT_SELECT} WHERE p.owner = ? ORDER BY p.name COLLATE NOCASE`);
  const selectProject = db.prepare(`${PROJECT_SELECT} WHERE p.id = ? AND p.owner = ?`);
  const selectProjectByName = db.prepare(`${PROJECT_SELECT} WHERE p.owner = ? AND p.name = ? COLLATE NOCASE`);
  const countProjects = db.prepare("SELECT count(*) AS n FROM projects WHERE owner = ?");
  const insertProject = db.prepare(
    "INSERT INTO projects (id, owner, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  );
  const updateProjectRow = db.prepare(
    "UPDATE projects SET name = ?, estimate_s = ?, archived_at = ?, updated_at = ? WHERE id = ? AND owner = ?",
  );
  const deleteProjectRow = db.prepare("DELETE FROM projects WHERE id = ? AND owner = ?");
  const countProjectSessions = db.prepare("SELECT count(*) AS n FROM sessions WHERE project_id = ?");
  const moveSessions = db.prepare("UPDATE sessions SET project_id = ?, updated_at = ? WHERE project_id = ?");
  // A project nothing is left in: no session, no estimate (e.g. a typo, corrected).
  const deleteIfEmpty = db.prepare(
    `DELETE FROM projects WHERE id = ? AND estimate_s IS NULL
       AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.project_id = projects.id)`,
  );
  const selectChanges = db.prepare(`
    SELECT c.project_id, c.at, c.from_s, c.to_s FROM estimate_changes c JOIN projects p ON p.id = c.project_id
    WHERE p.owner = ? ORDER BY c.id`);
  const insertChange = db.prepare("INSERT INTO estimate_changes (project_id, at, from_s, to_s) VALUES (?, ?, ?, ?)");

  // $known: a JSON array of usernames.
  const UNKNOWN_OWNER = "owner NOT IN (SELECT value FROM json_each($known))";
  const countUnknownOwners = db.prepare(`
    SELECT owner, sum(session) AS sessions, sum(project) AS projects FROM (
      SELECT owner, 1 AS session, 0 AS project FROM sessions WHERE ${UNKNOWN_OWNER}
      UNION ALL SELECT owner, 0, 1 FROM projects WHERE ${UNKNOWN_OWNER}
    ) GROUP BY owner ORDER BY owner`);
  // Sessions take their tags with them, projects their estimates.
  const deleteUnknown = ["sessions", "projects"].map((table) =>
    db.prepare(`DELETE FROM ${table} WHERE ${UNKNOWN_OWNER}`),
  );

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

  /** Writes down the automatic stop of every session past it. Returns whose sessions stopped. */
  function expire(): string[] {
    const rows = expireRunning.all(nowIso(), nowS()) as { owner: string }[];
    return [...new Set(rows.map((r) => r.owner))];
  }

  function toSession(row: SessionRow, now = nowS()): Session {
    return {
      id: row.id,
      projectId: row.project_id,
      project: row.project_name,
      tags: JSON.parse(row.tags) as string[],
      startedAt: iso(row.started_at),
      endedAt: row.ended_at === null ? null : iso(row.ended_at),
      cutoffAt: iso(row.cutoff_at),
      zone: row.zone,
      day: row.day,
      stop: row.stop,
      seconds: Math.max(0, Math.min(row.ended_at ?? now, row.cutoff_at) - row.started_at),
    };
  }

  function sessionRow(owner: string, id: string): SessionRow {
    return (selectSession.get(id, owner) as SessionRow | undefined) ?? notFound("session");
  }

  function setTags(sessionId: string, tags: string[]): void {
    deleteTags.run(sessionId);
    tags.forEach((tag, i) => insertTag.run(sessionId, i, tag));
  }

  /** The parameters that place the periods around `day`. */
  function periodParams(day: string): Record<string, SQLInputValue> {
    const monday = weekStart(day);
    return { $now: nowS(), $day: day, $week_from: monday, $week_to: addDays(monday, 6), $month: monthOf(day) };
  }

  function toPeriods(row: PeriodRow | undefined): Periods {
    return {
      today: { seconds: row?.today_s ?? 0, sessions: row?.today_n ?? 0 },
      week: { seconds: row?.week_s ?? 0, sessions: row?.week_n ?? 0 },
      month: { seconds: row?.month_s ?? 0, sessions: row?.month_n ?? 0 },
      overall: { seconds: row?.overall_s ?? 0, sessions: row?.overall_n ?? 0 },
    };
  }

  function periods(owner: string, projectId: string | null, day: string): Periods {
    return toPeriods(
      selectPeriods.get({ $owner: owner, $project: projectId, ...periodParams(day) }) as PeriodRow | undefined,
    );
  }

  function projectRow(owner: string, id: string): ProjectRow {
    return (selectProject.get(id, owner) as ProjectRow | undefined) ?? notFound("project");
  }

  /** The project with this name (ignoring case), made if there is none; an archived one comes back. */
  function projectNamed(owner: string, name: string): ProjectRow {
    const found = selectProjectByName.get(owner, name) as ProjectRow | undefined;
    if (found) {
      if (found.archived_at) {
        updateProjectRow.run(found.name, found.estimate_s, null, nowIso(), found.id, owner);
        return { ...found, archived_at: null };
      }
      return found;
    }
    const { n } = countProjects.get(owner) as { n: number };
    if (n >= LIMITS.projects) throw new StoreError(400, `You can have at most ${LIMITS.projects} projects`, "too-many");
    const id = randomUUID();
    const at = nowIso();
    insertProject.run(id, owner, name, at, at);
    return projectRow(owner, id);
  }

  /** The project id for a name from the page (null: no project). */
  function projectIdFor(owner: string, value: unknown): string | null {
    const name = projectName(value);
    return name === null ? null : projectNamed(owner, name).id;
  }

  return {
    closeExpired: expire,

    /**
     * Play. Starts a session in the browser's time zone, unless one is running already: then it
     * answers that one, so two tabs or devices pressing Play don't start two.
     */
    start(owner: string, input: unknown): Session {
      return transaction(() => {
        expire();
        const running = selectRunning.get(owner) as SessionRow | undefined;
        if (running) return toSession(running);
        const b = objectBody(input);
        const zone = zoneName(b.zone);
        if (!zone) invalid("The time zone must be a named one, such as America/Sao_Paulo");
        const tags = b.tags === undefined ? [] : tagList(b.tags);
        const projectId = b.project === undefined ? null : projectIdFor(owner, b.project);
        const start = nowS();
        const { day, cutoffMs } = sessionBounds(start * 1000, zone);
        const id = randomUUID();
        const at = nowIso();
        insertSession.run(id, owner, projectId, start, cutoffMs / 1000, zone, day, at, at);
        setTags(id, tags);
        return toSession(sessionRow(owner, id));
      });
    },

    /** Stop. */
    stop(owner: string): Session {
      return transaction(() => {
        expire();
        const running = selectRunning.get(owner) as SessionRow | undefined;
        if (!running) throw new StoreError(409, "No session is running", "not-running");
        updateSessionRow.run(running.project_id, running.started_at, nowS(), "manual", nowIso(), running.id, owner);
        return toSession(sessionRow(owner, running.id));
      });
    },

    /**
     * Names a session (its project and tags, at any time), or shortens it: its start may only move
     * later and its end earlier, so no time is ever added. Ending a running session earlier stops it.
     */
    updateSession(owner: string, id: string, input: unknown): Session {
      return transaction(() => {
        expire();
        const row = sessionRow(owner, id);
        const b = objectBody(input);
        const tags = b.tags === undefined ? null : tagList(b.tags);
        const now = nowS();
        let start = row.started_at;
        let end = row.ended_at;
        let stop = row.stop;
        if (b.startedAt !== undefined) {
          start = seconds(b.startedAt, "startedAt");
          if (start < row.started_at) invalid("A session can only be shortened: its start can't move earlier");
        }
        if (b.endedAt !== undefined) {
          end = seconds(b.endedAt, "endedAt");
          if (end > (row.ended_at ?? now)) invalid("A session can only be shortened: its end can't move later");
          if (row.ended_at === null) stop = "manual";
        }
        // Checked only when times change: a session started this second can still be named.
        if ((b.startedAt !== undefined || b.endedAt !== undefined) && (end === null ? start > now : start >= end)) {
          invalid("A session must end after it starts");
        }
        const projectId = b.project === undefined ? row.project_id : projectIdFor(owner, b.project);
        updateSessionRow.run(projectId, start, end, stop, nowIso(), id, owner);
        if (tags) setTags(id, tags);
        if (row.project_id && row.project_id !== projectId) deleteIfEmpty.run(row.project_id);
        return toSession(sessionRow(owner, id));
      });
    },

    /**
     * Deletes a session; a running one is simply gone, as if Play had never been pressed. Its
     * project goes too if nothing is left in it.
     */
    deleteSession(owner: string, id: string): void {
      transaction(() => {
        const deleted = deleteSessionRow.get(id, owner) as { project_id: string | null } | undefined;
        if (!deleted) return notFound("session");
        if (deleted.project_id) deleteIfEmpty.run(deleted.project_id);
      });
    },

    /**
     * The timer's numbers, around `today` (the page's date), or the running session's day. Also for
     * one project: ?project=, else the running session's.
     */
    state(owner: string, query: Record<string, unknown>): TimerState {
      if (!isDate(query.today)) invalid("today must be a date written YYYY-MM-DD");
      expire();
      const now = nowS();
      const runningRow = selectRunning.get(owner) as SessionRow | undefined;
      const lastRow = selectLast.get(owner) as SessionRow | undefined;
      const day = runningRow?.day ?? query.today;
      const projectId =
        typeof query.project === "string" && query.project ? query.project : (runningRow?.project_id ?? null);
      const project = projectId === null ? undefined : (selectProject.get(projectId, owner) as ProjectRow | undefined);
      return {
        now: iso(now),
        day,
        running: runningRow ? toSession(runningRow, now) : null,
        last: lastRow ? toSession(lastRow, now) : null,
        all: periods(owner, null, day),
        project: project ? { id: project.id, name: project.name, periods: periods(owner, project.id, day) } : null,
        unnamed: (countUnnamed.get(owner) as { n: number }).n,
      };
    },

    /** Days of sessions before ?before= (newest first), only unnamed ones with ?unnamed=1, or one project's. */
    sessions(owner: string, query: Record<string, unknown>): HistoryPage {
      if (query.before !== undefined && !isDate(query.before)) invalid("before must be a date written YYYY-MM-DD");
      const filters = {
        $owner: owner,
        $unnamed: query.unnamed === "1" ? 1 : 0,
        $project: typeof query.project === "string" && query.project ? query.project : null,
      };
      const days = (
        selectHistoryDays.all({
          ...filters,
          $before: (query.before as string | undefined) ?? "9999-12-31",
          $limit: LIMITS.historyDays + 1,
        }) as { day: string }[]
      ).map((r) => r.day);
      const more = days.length > LIMITS.historyDays;
      const shown = days.slice(0, LIMITS.historyDays);
      if (shown.length === 0) return { sessions: [], next: null };
      expire();
      const now = nowS();
      const rows = selectHistory.all({ ...filters, $from: shown.at(-1)!, $to: shown[0]! }) as unknown as SessionRow[];
      return { sessions: rows.map((r) => toSession(r, now)), next: more ? shown.at(-1)! : null };
    },

    /** Every project, with its time around `?day=` and its estimate's history. */
    projects(owner: string, query: Record<string, unknown>): Project[] {
      if (!isDate(query.day)) invalid("day must be a date written YYYY-MM-DD");
      expire();
      const totals = new Map(
        (selectProjectPeriods.all({ $owner: owner, ...periodParams(query.day) }) as unknown as PeriodRow[]).map((r) => [
          r.project_id!,
          r,
        ]),
      );
      const logs = new Map<string, EstimateChange[]>();
      for (const c of selectChanges.all(owner) as unknown as ChangeRow[]) {
        const log = logs.get(c.project_id) ?? [];
        log.push({ at: iso(c.at), from: c.from_s, to: c.to_s });
        logs.set(c.project_id, log);
      }
      return (selectProjects.all(owner) as unknown as ProjectRow[]).map((p) => ({
        id: p.id,
        name: p.name,
        estimate: p.estimate_s,
        estimateLog: logs.get(p.id) ?? [],
        archived: p.archived_at !== null,
        createdAt: p.created_at,
        lastUsedAt: p.last_used === null ? null : iso(p.last_used),
        periods: toPeriods(totals.get(p.id)),
      }));
    },

    /**
     * Renames, archives or re-estimates a project. A name another project has is refused (409
     * "exists") unless `merge` is true: then this project's sessions move to that one, and this one
     * goes. Answers the id of the project that remains.
     */
    updateProject(owner: string, id: string, input: unknown): { id: string } {
      return transaction(() => {
        const row = projectRow(owner, id);
        const b = objectBody(input);
        let name = row.name;
        if (b.name !== undefined) {
          const given = projectName(b.name);
          if (given === null) invalid("A project needs a name");
          const other = selectProjectByName.get(owner, given) as ProjectRow | undefined;
          if (other && other.id !== id) {
            if (b.merge !== true) {
              throw new StoreError(409, `There is already a project called “${other.name}”`, "exists");
            }
            moveSessions.run(other.id, nowIso(), id);
            deleteProjectRow.run(id, owner);
            return { id: other.id };
          }
          name = given;
        }
        let archivedAt = row.archived_at;
        if (b.archived !== undefined) {
          if (typeof b.archived !== "boolean") invalid("archived must be true or false");
          archivedAt = b.archived ? (row.archived_at ?? nowIso()) : null;
        }
        let estimate = row.estimate_s;
        if (b.estimate !== undefined) {
          if (
            b.estimate !== null &&
            (!Number.isSafeInteger(b.estimate) ||
              (b.estimate as number) < 60 ||
              (b.estimate as number) > LIMITS.estimateSeconds)
          ) {
            invalid("The estimate must be a whole number of seconds, from a minute to 100,000 hours, or null");
          }
          estimate = b.estimate as number | null;
          if (estimate !== row.estimate_s) insertChange.run(id, nowS(), row.estimate_s, estimate);
        }
        updateProjectRow.run(name, estimate, archivedAt, nowIso(), id, owner);
        return { id };
      });
    },

    /** Deletes a project that has no sessions (sessions are deleted one by one, in the history). */
    deleteProject(owner: string, id: string): void {
      transaction(() => {
        projectRow(owner, id);
        const { n } = countProjectSessions.get(id) as { n: number };
        if (n > 0) throw new StoreError(409, "Only a project without sessions can be deleted", "not-empty");
        deleteProjectRow.run(id, owner);
      });
    },

    /** The tags a user has used, the most used first. */
    tags(owner: string): TagCount[] {
      return selectTags.all(owner) as unknown as TagCount[];
    },

    /** Every session as CSV, oldest first, times on the wall clock where each was started. */
    exportCsv(owner: string): string {
      expire();
      const now = nowS();
      const lines = ["day,start,end,zone,seconds,hours,project,tags,stop"];
      for (const row of selectAllSessions.all(owner) as unknown as SessionRow[]) {
        const s = toSession(row, now);
        lines.push(
          [
            s.day,
            wallText(row.started_at, row.zone),
            row.ended_at === null ? "" : wallText(row.ended_at, row.zone),
            s.zone,
            String(s.seconds),
            (s.seconds / 3600).toFixed(2),
            s.project ?? "",
            s.tags.join(" "),
            s.stop ?? "running",
          ]
            .map(csvField)
            .join(","),
        );
      }
      return `${lines.join("\r\n")}\r\n`;
    },

    /**
     * Deletes for good every session and project of every owner who isn't in `known` (Heimdall's
     * usernames), i.e. of users removed from Heimdall. Returns how much each of them had.
     */
    removeUnknownOwners(known: ReadonlySet<string>): { owner: string; sessions: number; projects: number }[] {
      const $known = JSON.stringify([...known]);
      return transaction(() => {
        const removed = countUnknownOwners.all({ $known }) as { owner: string; sessions: number; projects: number }[];
        for (const stmt of deleteUnknown) stmt.run({ $known });
        return removed;
      });
    },
  };
}

export type Store = ReturnType<typeof createStore>;
