import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { addDays, isDate, monthOf, pad, weekStart } from "../shared/dates.ts";
import { dayOf, daySpans, lastDayOf } from "../shared/days.ts";
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
  type Tally,
  type Task,
  type TimerState,
} from "../shared/protocol.ts";
import { instantOf, isInstant, msOf, toWall, zoneName } from "../shared/zones.ts";

// The only place sessions and projects are read and written. Every query names the owner (a
// Heimdall username), so nobody reaches another user's data; a row that belongs to someone else
// answers exactly like one that doesn't exist.
//
// Only the user stops a session. While it runs, its time is counted up to now. Its time counts for
// the local days it covers (split at midnight, see shared/days.ts): sums over all time are done in
// SQL, and those for a day, a week or a month split the sessions that reach into them.

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
  task: string | null;
  started_at: number;
  ended_at: number | null;
  zone: string;
  day: string;
  end_day: string | null;
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

/** A session as the periods need it. */
interface SpanRow {
  project_id: string | null;
  task: string | null;
  started_at: number;
  ended_at: number | null;
  zone: string;
}

/** All of a group's time, from SQL. */
interface OverallRow {
  project_id?: string | null;
  seconds: number;
  sessions: number;
}

/** A task's sessions together, from SQL. */
interface TaskRow extends OverallRow {
  project_id: string | null;
  project_name: string | null;
  task: string | null;
  first: number;
  last: number;
  /** JSON array: the tags of its latest session */
  tags: string;
}

/** The periods but `overall`, which comes from SQL. */
type Around = Omit<Periods, "overall">;

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

/** A task's name as given, trimmed; null for none ("" or null). */
function taskName(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") invalid("The task must be a name");
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length > LIMITS.taskNameChars) invalid(`A task's name has at most ${LIMITS.taskNameChars} characters`);
  return name || null;
}

/** The key of a task: its project and its name, ignoring case. */
const taskKey = (projectId: string | null, task: string | null) =>
  JSON.stringify([projectId, task?.toLowerCase() ?? null]);

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

  // A session's seconds: up to now while it runs.
  const SECS = "max(0, coalesce(ended_at, $now) - started_at)";
  // Time and sessions ever.
  const OVERALL_COLUMNS = `coalesce(sum(${SECS}), 0) AS seconds, count(*) AS sessions`;
  // Sessions with time in the days $from to $to. Only the running one has no end_day, and it is
  // never later than today.
  const REACHES = "day <= $to AND (end_day IS NULL OR end_day >= $from)";

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
  // History's filters, on the sessions table as `s`. Unnamed: neither a project nor a task.
  const HISTORY_FILTERS = `($unnamed = 0 OR (s.project_id IS NULL AND s.task IS NULL))
    AND ($project IS NULL OR s.project_id = $project)`;
  // Every day up to $last that a session has time in: from its start day to its end day (the
  // running one's: $open_end, today where it was started).
  const selectHistoryDays = db.prepare(`
    WITH RECURSIVE covered(day, last) AS (
      SELECT s.day, min(coalesce(s.end_day, $open_end), $last) FROM sessions s
      WHERE s.owner = $owner AND s.day <= $last AND ${HISTORY_FILTERS}
      UNION
      SELECT date(day, '+1 day'), last FROM covered WHERE day < last
    )
    SELECT DISTINCT day FROM covered ORDER BY day DESC LIMIT $limit`);
  const selectHistory = db.prepare(`
    ${SESSION_SELECT}
    WHERE s.owner = $owner AND s.day <= $to AND coalesce(s.end_day, $open_end) >= $from AND ${HISTORY_FILTERS}
    ORDER BY s.started_at DESC`);
  const selectAllSessions = db.prepare(`${SESSION_SELECT} WHERE s.owner = ? ORDER BY s.started_at`);
  const countUnnamed = db.prepare(
    "SELECT count(*) AS n FROM sessions WHERE owner = ? AND project_id IS NULL AND task IS NULL",
  );
  const insertSession = db.prepare(
    `INSERT INTO sessions (id, owner, project_id, task, started_at, zone, day, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateSessionRow = db.prepare(
    `UPDATE sessions SET project_id = ?, task = ?, started_at = ?, ended_at = ?, day = ?, end_day = ?, stop = ?,
       updated_at = ?
     WHERE id = ? AND owner = ?`,
  );
  // A task's name as its first session spelled it.
  const selectTaskSpelling = db.prepare(`
    SELECT task FROM sessions WHERE owner = ? AND project_id IS ? AND task = ? COLLATE NOCASE
    ORDER BY started_at LIMIT 1`);
  // The sessions of a task ($task NULL: of its project's sessions without one).
  const TASK_SESSIONS = `owner = $owner AND project_id IS $project
    AND (($task IS NULL AND task IS NULL) OR task = $task COLLATE NOCASE)`;
  const moveTask = db.prepare(
    `UPDATE sessions SET project_id = $to_project, task = $to_task, updated_at = $at WHERE ${TASK_SESSIONS}`,
  );
  // Every task with all its time, and the tags of its latest session.
  const selectTasks = db.prepare(`
    SELECT g.*, p.name AS project_name,
      (SELECT json_group_array(tag) FROM
        (SELECT tag FROM session_tags t WHERE t.session_id = (
          SELECT id FROM sessions s WHERE s.owner = $owner AND s.project_id IS g.project_id
            AND ((g.task IS NULL AND s.task IS NULL) OR s.task = g.task COLLATE NOCASE)
          ORDER BY s.started_at DESC LIMIT 1
        ) ORDER BY position)) AS tags
    FROM (
      SELECT project_id, min(task) AS task, min(started_at) AS first, max(started_at) AS last, ${OVERALL_COLUMNS}
      FROM sessions WHERE owner = $owner GROUP BY project_id, task COLLATE NOCASE
    ) g LEFT JOIN projects p ON p.id = g.project_id
    ORDER BY g.last DESC`);
  const deleteSessionRow = db.prepare("DELETE FROM sessions WHERE id = ? AND owner = ? RETURNING project_id");
  const deleteTags = db.prepare("DELETE FROM session_tags WHERE session_id = ?");
  const insertTag = db.prepare("INSERT INTO session_tags (session_id, position, tag) VALUES (?, ?, ?)");
  const selectTags = db.prepare(`
    SELECT t.tag, count(*) AS count FROM session_tags t JOIN sessions s ON s.id = t.session_id
    WHERE s.owner = ? GROUP BY t.tag ORDER BY count DESC, t.tag LIMIT 500`);

  const selectReaching = db.prepare(
    `SELECT project_id, task, started_at, ended_at, zone FROM sessions WHERE owner = $owner AND ${REACHES}`,
  );
  // Everything ($scoped 0), a project's sessions ($scoped 1, $task NULL) or a task's.
  const selectOverall = db.prepare(`
    SELECT ${OVERALL_COLUMNS} FROM sessions
    WHERE owner = $owner AND ($scoped = 0 OR project_id IS $project)
      AND ($task IS NULL OR task = $task COLLATE NOCASE)`);
  const selectProjectOverall = db.prepare(`
    SELECT project_id, ${OVERALL_COLUMNS} FROM sessions
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

  function toSession(row: SessionRow, now = nowS()): Session {
    return {
      id: row.id,
      projectId: row.project_id,
      project: row.project_name,
      task: row.task,
      tags: JSON.parse(row.tags) as string[],
      startedAt: iso(row.started_at),
      endedAt: row.ended_at === null ? null : iso(row.ended_at),
      zone: row.zone,
      day: row.day,
      stop: row.stop,
      seconds: Math.max(0, (row.ended_at ?? now) - row.started_at),
    };
  }

  function sessionRow(owner: string, id: string): SessionRow {
    return (selectSession.get(id, owner) as SessionRow | undefined) ?? notFound("session");
  }

  function setTags(sessionId: string, tags: string[]): void {
    deleteTags.run(sessionId);
    tags.forEach((tag, i) => insertTag.run(sessionId, i, tag));
  }

  const emptyAround = (): Around => ({
    today: { seconds: 0, sessions: 0 },
    week: { seconds: 0, sessions: 0 },
    month: { seconds: 0, sessions: 0 },
  });

  /**
   * Time and sessions in `day`, its week and its month, for each group of sessions (`group` names a
   * session's group, or leaves it out with null). Each session is split at its midnights, and counts
   * in a period with the part of it that fell there.
   */
  function around(owner: string, day: string, group: (row: SpanRow) => string | null): Map<string, Around> {
    const monday = weekStart(day);
    const sunday = addDays(monday, 6);
    const month = monthOf(day);
    // The week and the month together ("-31" sorts after the last day of any month).
    const from = monday < `${month}-01` ? monday : `${month}-01`;
    const to = sunday > `${month}-31` ? sunday : `${month}-31`;
    const now = nowS();
    const groups = new Map<string, Around>();
    for (const row of selectReaching.all({ $owner: owner, $from: from, $to: to }) as unknown as SpanRow[]) {
      const key = group(row);
      if (key === null) continue;
      let totals = groups.get(key);
      if (!totals) groups.set(key, (totals = emptyAround()));
      const spans = daySpans(row.started_at * 1000, (row.ended_at ?? now) * 1000, row.zone);
      const count = (tally: Tally, inside: (d: string) => boolean) => {
        const parts = spans.filter((s) => inside(s.day));
        if (parts.length === 0) return;
        tally.sessions += 1;
        tally.seconds += parts.reduce((sum, s) => sum + s.seconds, 0);
      };
      count(totals.today, (d) => d === day);
      count(totals.week, (d) => d >= monday && d <= sunday);
      count(totals.month, (d) => monthOf(d) === month);
    }
    return groups;
  }

  const toTally = (row: OverallRow | undefined): Tally => ({
    seconds: row?.seconds ?? 0,
    sessions: row?.sessions ?? 0,
  });

  /**
   * The periods around `day` of every session (no `scope`), of a project's (`project`, which is
   * never null here) or of a task's (`task`, in `project` or in none).
   */
  function periods(owner: string, day: string, scope?: { project: string | null; task?: string }): Periods {
    const task = scope?.task?.toLowerCase();
    const inScope = (r: SpanRow) =>
      !scope || (r.project_id === scope.project && (task === undefined || r.task?.toLowerCase() === task));
    const near = around(owner, day, (r) => (inScope(r) ? "" : null)).get("");
    const overall = selectOverall.get({
      $owner: owner,
      $scoped: scope ? 1 : 0,
      $project: scope?.project ?? null,
      $task: scope?.task ?? null,
      $now: nowS(),
    }) as OverallRow | undefined;
    return { ...(near ?? emptyAround()), overall: toTally(overall) };
  }

  /** A task's name from the page, spelled as its first session in `projectId` spelled it. */
  function taskFor(owner: string, projectId: string | null, value: unknown): string | null {
    const name = taskName(value);
    if (name === null) return null;
    const found = selectTaskSpelling.get(owner, projectId, name) as { task: string } | undefined;
    return found?.task ?? name;
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

  /** Writes a session's project, task, times and stop, with the days they settle. */
  function writeSession(
    owner: string,
    row: SessionRow,
    names: { projectId: string | null; task: string | null },
    start: number,
    end: number | null,
    stop: StopKind | null,
  ): void {
    const day = dayOf(start * 1000, row.zone);
    const endDay = end === null ? null : lastDayOf(start * 1000, end * 1000, row.zone);
    updateSessionRow.run(names.projectId, names.task, start, end, day, endDay, stop, nowIso(), row.id, owner);
  }

  /** Stops the running session now. */
  function stopRunning(owner: string, running: SessionRow): void {
    const names = { projectId: running.project_id, task: running.task };
    writeSession(owner, running, names, running.started_at, nowS(), "manual");
  }

  return {
    /**
     * Play. Starts a session in the browser's time zone, unless one is running already: then it
     * answers that one, so two tabs or devices pressing Play don't start two. With `switch`, it
     * stops the running one instead, and starts this one in the same moment.
     */
    start(owner: string, input: unknown): Session {
      return transaction(() => {
        const b = objectBody(input);
        const running = selectRunning.get(owner) as SessionRow | undefined;
        if (running && b.switch !== true) return toSession(running);
        const zone = zoneName(b.zone);
        if (!zone) invalid("The time zone must be a named one, such as America/Sao_Paulo");
        const tags = b.tags === undefined ? [] : tagList(b.tags);
        const projectId = b.project === undefined ? null : projectIdFor(owner, b.project);
        const task = b.task === undefined ? null : taskFor(owner, projectId, b.task);
        if (running) stopRunning(owner, running);
        const start = nowS();
        const id = randomUUID();
        const at = nowIso();
        insertSession.run(id, owner, projectId, task, start, zone, dayOf(start * 1000, zone), at, at);
        setTags(id, tags);
        return toSession(sessionRow(owner, id));
      });
    },

    /** Stop. */
    stop(owner: string): Session {
      return transaction(() => {
        const running = selectRunning.get(owner) as SessionRow | undefined;
        if (!running) throw new StoreError(409, "No session is running", "not-running");
        stopRunning(owner, running);
        return toSession(sessionRow(owner, running.id));
      });
    },

    /**
     * Names a session (its project, task and tags, at any time), or shortens it: its start may only
     * move later and its end earlier, so no time is ever added. Ending a running session earlier
     * stops it. A session moved to another project takes its task's name there.
     */
    updateSession(owner: string, id: string, input: unknown): Session {
      return transaction(() => {
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
        const task =
          b.task !== undefined
            ? taskFor(owner, projectId, b.task)
            : projectId === row.project_id
              ? row.task
              : taskFor(owner, projectId, row.task);
        writeSession(owner, row, { projectId, task }, start, end, stop);
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
     * The timer's numbers, around `today` (the page's date). Also for one project and one task:
     * ?project= and ?task= (in that project, or in none), else the running session's.
     */
    state(owner: string, query: Record<string, unknown>): TimerState {
      if (!isDate(query.today)) invalid("today must be a date written YYYY-MM-DD");
      const now = nowS();
      const runningRow = selectRunning.get(owner) as SessionRow | undefined;
      const lastRow = selectLast.get(owner) as SessionRow | undefined;
      const day = query.today;
      const asked = (value: unknown) => (typeof value === "string" && value ? value : null);
      const askedProject = asked(query.project);
      const askedTask = asked(query.task);
      const projectId = askedProject ?? (askedTask ? null : (runningRow?.project_id ?? null));
      const project = projectId === null ? undefined : (selectProject.get(projectId, owner) as ProjectRow | undefined);
      let task: TimerState["task"] = null;
      const taskScope = askedTask
        ? { project: askedProject, task: askedTask }
        : !askedProject && runningRow?.task
          ? { project: runningRow.project_id, task: runningRow.task }
          : null;
      if (taskScope) {
        const spelled = selectTaskSpelling.get(owner, taskScope.project, taskScope.task) as
          { task: string } | undefined;
        const name = spelled?.task ?? taskScope.task;
        task = {
          projectId: taskScope.project,
          name,
          periods: periods(owner, day, { project: taskScope.project, task: name }),
        };
      }
      return {
        now: iso(now),
        day,
        running: runningRow ? toSession(runningRow, now) : null,
        last: lastRow ? toSession(lastRow, now) : null,
        all: periods(owner, day),
        project: project
          ? { id: project.id, name: project.name, periods: periods(owner, day, { project: project.id }) }
          : null,
        task,
        unnamed: (countUnnamed.get(owner) as { n: number }).n,
      };
    },

    /**
     * Days of sessions before ?before= (newest first), only unnamed ones with ?unnamed=1, or one
     * project's. A session that runs past midnight is on every day it has time in.
     */
    sessions(owner: string, query: Record<string, unknown>): HistoryPage {
      if (query.before !== undefined && !isDate(query.before)) invalid("before must be a date written YYYY-MM-DD");
      const now = nowS();
      const running = selectRunning.get(owner) as SessionRow | undefined;
      const filters: Record<string, SQLInputValue> = {
        $owner: owner,
        $unnamed: query.unnamed === "1" ? 1 : 0,
        $project: typeof query.project === "string" && query.project ? query.project : null,
        // Only the running session has no end day: it reaches today, where it was started.
        $open_end: running ? dayOf(now * 1000, running.zone) : "0000-01-01",
      };
      const days = (
        selectHistoryDays.all({
          ...filters,
          $last: query.before === undefined ? "9999-12-31" : addDays(query.before as string, -1),
          $limit: LIMITS.historyDays + 1,
        }) as { day: string }[]
      ).map((r) => r.day);
      const more = days.length > LIMITS.historyDays;
      const shown = days.slice(0, LIMITS.historyDays);
      if (shown.length === 0) return { days: [], sessions: [], next: null };
      const rows = selectHistory.all({ ...filters, $from: shown.at(-1)!, $to: shown[0]! }) as unknown as SessionRow[];
      return { days: shown, sessions: rows.map((r) => toSession(r, now)), next: more ? shown.at(-1)! : null };
    },

    /** Every project, with its time around `?day=` and its estimate's history. */
    projects(owner: string, query: Record<string, unknown>): Project[] {
      if (!isDate(query.day)) invalid("day must be a date written YYYY-MM-DD");
      const near = around(owner, query.day, (r) => r.project_id);
      const overall = new Map(
        (selectProjectOverall.all({ $owner: owner, $now: nowS() }) as unknown as OverallRow[]).map((r) => [
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
        periods: { ...(near.get(p.id) ?? emptyAround()), overall: toTally(overall.get(p.id)) },
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

    /**
     * Every task, the latest used first, with its time around `?day=` and the tags of its latest
     * session. Each project's sessions without a task are one more, without a name.
     */
    tasks(owner: string, query: Record<string, unknown>): Task[] {
      if (!isDate(query.day)) invalid("day must be a date written YYYY-MM-DD");
      const near = around(owner, query.day, (r) => taskKey(r.project_id, r.task));
      return (selectTasks.all({ $owner: owner, $now: nowS() }) as unknown as TaskRow[]).map((t) => ({
        projectId: t.project_id,
        project: t.project_name,
        name: t.task,
        firstStartedAt: iso(t.first),
        lastStartedAt: iso(t.last),
        lastTags: JSON.parse(t.tags) as string[],
        periods: { ...(near.get(taskKey(t.project_id, t.task)) ?? emptyAround()), overall: toTally(t) },
      }));
    },

    /**
     * Renames a task, or moves it to another project: all its sessions change. A name the target
     * already has puts the two tasks together. Answers where the task is now.
     */
    updateTask(owner: string, input: unknown): { projectId: string | null; name: string | null } {
      return transaction(() => {
        const b = objectBody(input);
        if (b.projectId !== null && typeof b.projectId !== "string")
          invalid("projectId must be a project's id or null");
        const from = b.projectId as string | null;
        if (from !== null) projectRow(owner, from);
        const name = taskName(b.name ?? null);
        const to = b.project === undefined ? from : projectIdFor(owner, b.project);
        let rename = b.rename === undefined ? name : taskName(b.rename);
        // A new spelling of its own name is kept; another task's name takes that task's spelling.
        const sameTask = to === from && rename?.toLowerCase() === name?.toLowerCase();
        if (!sameTask) rename = taskFor(owner, to, rename);
        moveTask.run({ $owner: owner, $project: from, $task: name, $to_project: to, $to_task: rename, $at: nowIso() });
        if (from !== null && from !== to) deleteIfEmpty.run(from);
        return { projectId: to, name: rename };
      });
    },

    /** The tags a user has used, the most used first. */
    tags(owner: string): TagCount[] {
      return selectTags.all(owner) as unknown as TagCount[];
    },

    /** Every session as CSV, oldest first, times on the wall clock where each was started. */
    exportCsv(owner: string): string {
      const now = nowS();
      const lines = ["day,start,end,zone,seconds,hours,project,task,tags,stop"];
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
            s.task ?? "",
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
