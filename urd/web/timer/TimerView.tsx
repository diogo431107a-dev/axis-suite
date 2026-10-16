import { useEffect, useState, type ReactNode } from "react";
import { Play, Plus, Square } from "lucide-react";
import { addDays } from "../../shared/dates.ts";
import type { Periods, Project, Session, TagCount, Tally, Task, TimerState } from "../../shared/protocol.ts";
import { elapsed, livePeriods, useSecond } from "../clock.ts";
import { clock, dayShort, hours, localDay, sessionName, sessionsText, timeOfDay } from "../format.ts";
import { Link } from "../ui/Link.tsx";
import { ProjectField } from "../ui/ProjectField.tsx";
import { TagsField } from "../ui/TagsField.tsx";
import { TaskField } from "../ui/TaskField.tsx";
import { label, secondaryButton } from "../ui/buttons.ts";
import type { Timer } from "./useTimer.ts";

interface TimerViewProps {
  timer: Timer;
  today: string;
  projects: Project[];
  /** the latest used first */
  tasks: Task[];
  tags: TagCount[];
  /** opens a project's dialog (its estimate, name…) */
  onOpenProject: (project: Project) => void;
  onEstimate: (project: Project, seconds: number) => void;
}

/** Whether a key press is meant for a field, a button or a dialog rather than for the page. */
function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (document.querySelector("dialog[open]")) return true;
  return !!t?.closest("input, textarea, select, button, a, [contenteditable='true']");
}

export function TimerView({ timer, today, projects, tasks, tags, onOpenProject, onEstimate }: TimerViewProps) {
  const { state, shown, busy, toggle } = timer;
  const running = state?.running ?? null;

  // Space starts and stops, unless the focus is in a field or on a button (which Space presses).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
      e.preventDefault();
      void toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const project = state?.project ? projects.find((p) => p.id === state.project!.id) : undefined;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8 px-4 py-6 sm:py-10">
      <section className="flex flex-col items-center gap-5" aria-label="Timer">
        <BigClock running={running} skew={timer.skew} />
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={!state || busy}
          aria-label={running ? "Stop" : "Start"}
          title={running ? "Stop (Space)" : "Start (Space)"}
          className={`flex h-20 w-20 items-center justify-center rounded-full text-white shadow-md transition-colors
            focus:outline-none focus-visible:ring-4 disabled:opacity-50 ${
              running
                ? "bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-300"
                : "bg-sky-700 hover:bg-sky-800 focus-visible:ring-sky-300"
            }`}
        >
          {running ? (
            <Square className="h-8 w-8" fill="currentColor" />
          ) : (
            <Play className="ml-1 h-9 w-9" fill="currentColor" />
          )}
        </button>
        <p className="min-h-5 text-center text-sm text-zinc-500 dark:text-zinc-400">
          <Hint state={state} today={today} />
        </p>
      </section>

      {state && (
        <Resume
          tasks={tasks}
          running={running}
          busy={busy}
          filled={!!(shown.project || shown.task || shown.tags.length)}
          onResume={(task) => void timer.resume(task)}
          // The new task's name comes first.
          onNew={() => void timer.newTask().then(() => document.getElementById("timer-project")?.focus())}
        />
      )}

      <section className="grid gap-3 sm:grid-cols-2" aria-label={running ? "This session" : "The next session"}>
        <div>
          <label htmlFor="timer-project" className={label}>
            Project
          </label>
          <ProjectField
            id="timer-project"
            value={shown.project}
            projects={projects}
            onCommit={(name) => void timer.setProject(name)}
            placeholder="None yet: name it later"
          />
        </div>
        <div>
          <label htmlFor="timer-task" className={label}>
            Task
          </label>
          <TaskField
            id="timer-task"
            value={shown.task}
            tasks={tasks}
            project={shown.project}
            onCommit={(name) => void timer.setTask(name)}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="timer-tags" className={label}>
            Tags
          </label>
          <TagsField
            id="timer-tags"
            tags={shown.tags}
            suggestions={tags.map((t) => t.tag)}
            onChange={(t) => void timer.setTags(t)}
          />
        </div>
      </section>

      {state && project && (
        <EstimateBar
          project={project}
          periods={state.project!.periods}
          day={state.day}
          running={running?.projectId === project.id ? running : null}
          skew={timer.skew}
          onOpen={() => onOpenProject(project)}
          onEstimate={(seconds) => onEstimate(project, seconds)}
        />
      )}

      {state && <Stats state={state} today={today} skew={timer.skew} />}

      {state && state.unnamed > 0 && (
        <p className="text-center text-sm">
          <Link
            to={{ kind: "history", unnamed: true }}
            className="text-sky-700 dark:text-sky-400 underline hover:text-sky-900 dark:hover:text-sky-300"
          >
            {sessionsText(state.unnamed)} without a project or task
          </Link>
        </p>
      )}
    </div>
  );
}

/** The session's time in big figures: it runs while the session does. */
function BigClock({ running, skew }: { running: Session | null; skew: number }) {
  const now = useSecond(!!running) + skew;
  return (
    <div
      role="timer"
      aria-live="off"
      className={`font-light tracking-tight tabular-nums text-7xl sm:text-8xl ${running ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-300 dark:text-zinc-700"}`}
    >
      {clock(running ? elapsed(running, now) : 0)}
    </div>
  );
}

/** One line under the button: when the session started, or what the last one was. */
function Hint({ state, today }: { state: TimerState | null; today: string }) {
  if (!state) return null;
  if (state.running) {
    const { startedAt } = state.running;
    const started = localDay(startedAt);
    const when = started === today ? "" : started === addDays(today, -1) ? " yesterday" : ` on ${dayShort(started)}`;
    return (
      <>
        Started at {timeOfDay(startedAt)}
        {when}
      </>
    );
  }
  const last = state.last;
  if (!last) return <>Press Play (or Space) to start</>;
  return (
    <>
      Last session {clock(last.seconds)}
      {last.project || last.task ? ` · ${sessionName(last)}` : ""}
      {last.stop === "auto" ? " · stopped by itself" : ""}
    </>
  );
}

/** Whether a task is the one a session is in. */
const isOf = (task: Task, s: Session) =>
  task.projectId === s.projectId && (task.name ?? "").toLowerCase() === (s.task ?? "").toLowerCase();

interface ResumeProps {
  /** the latest used first */
  tasks: Task[];
  running: Session | null;
  busy: boolean;
  /** whether the next session has a project, task or tags */
  filled: boolean;
  onResume: (task: Task) => void;
  onNew: () => void;
}

/**
 * The latest tasks, each started again with one click and its last tags; and New task, for one not
 * among them. A running session stops for either.
 */
function Resume({ tasks, running, busy, filled, onResume, onNew }: ResumeProps) {
  const recent = tasks
    .filter((t) => (t.name !== null || t.project !== null) && !(running && isOf(t, running)))
    .slice(0, 5);
  // New task has nothing to do when nothing runs and the fields are empty already.
  const canNew = !!running || filled;
  if (recent.length === 0 && !canNew) return null;
  return (
    <section
      aria-labelledby={recent.length ? "resume-heading" : undefined}
      aria-label={recent.length ? undefined : "New task"}
      className="-mt-2"
    >
      <div className="flex items-end justify-between gap-3">
        {recent.length > 0 && (
          <h2 id="resume-heading" className={label}>
            Resume
          </h2>
        )}
        {canNew && (
          <button
            type="button"
            disabled={busy}
            onClick={onNew}
            title={running ? "Stop the running session and empty the fields" : "Empty the fields for a new task"}
            className={`${secondaryButton} mb-1 ml-auto px-2 py-1 text-xs`}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New task
          </button>
        )}
      </div>
      {recent.length > 0 && (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          {recent.map((t) => (
            <li key={`${t.projectId}\n${t.name}`}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onResume(t)}
                title={running ? "Stop the running session and start this one" : "Start this one"}
                className="flex w-full items-baseline gap-3 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/60
                         focus:outline-none focus-visible:bg-zinc-50 dark:focus-visible:bg-zinc-800/60 disabled:opacity-50"
              >
                <Play
                  className="h-3.5 w-3.5 shrink-0 self-center text-sky-700 dark:text-sky-400"
                  fill="currentColor"
                  aria-hidden
                />
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                  <span className="min-w-0 break-words text-zinc-800 dark:text-zinc-100">{t.name ?? t.project}</span>
                  {t.name !== null && t.project !== null && (
                    <span className="text-zinc-500 dark:text-zinc-400">{t.project}</span>
                  )}
                  {t.lastTags.map((tag) => (
                    <span key={tag} className="text-zinc-400 dark:text-zinc-500">
                      #{tag}
                    </span>
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** What the numbers are about: the task, its project, or everything. */
type Scope = "task" | "project" | "all";
const SCOPES: { scope: Scope; name: string }[] = [
  { scope: "task", name: "Task" },
  { scope: "project", name: "Project" },
  { scope: "all", name: "All" },
];
const SCOPE_KEY = "urd.scope";

function loadScope(): Scope {
  try {
    const value = localStorage.getItem(SCOPE_KEY);
    return value === "project" || value === "all" ? value : "task";
  } catch {
    return "task";
  }
}

function saveScope(scope: Scope): void {
  try {
    localStorage.setItem(SCOPE_KEY, scope);
  } catch {
    // not kept: the next visit starts with the task
  }
}

/**
 * Time, interruptions and the longest uninterrupted work: for the session, the day, its week and
 * month, and ever; of the task, the project or everything (the choice is kept on this computer).
 */
function Stats({ state, today, skew }: { state: TimerState; today: string; skew: number }) {
  const [chosen, setChosen] = useState(loadScope);
  const running = state.running;
  const now = useSecond(!!running) + skew;
  const { task, project } = state;

  // A scope the shown session hasn't (no task, no project) gives way to the next wider one.
  const available: Record<Scope, boolean> = { task: !!task, project: !!project, all: true };
  const order: Scope[] = ["task", "project", "all"];
  const scope = order.slice(order.indexOf(chosen)).find((s) => available[s])!;
  const inScope = (s: Session | null): boolean =>
    !!s &&
    (scope === "all" ||
      (scope === "project" && s.projectId === project!.id) ||
      (scope === "task" && s.projectId === task!.projectId && s.task?.toLowerCase() === task!.name.toLowerCase()));
  const base = scope === "task" ? task!.periods : scope === "project" ? project!.periods : state.all;
  const periods = livePeriods(base, inScope(running) ? running : null, now, state.day);
  const session = running ?? state.last;
  const sessionSeconds = running ? elapsed(running, now) : (state.last?.seconds ?? 0);
  const label = scope === "task" ? task!.name : scope === "project" ? project!.name : "All projects";

  const rows: { name: string; tally: Tally | null; long: boolean; first?: boolean }[] = [
    {
      name: running ? "This session" : "Last session",
      tally: inScope(session) ? { seconds: sessionSeconds, sessions: 1, longest: sessionSeconds } : null,
      long: false,
      first: true,
    },
    ...(
      [
        [state.day === today ? "Today" : dayShort(state.day), "today", false],
        ["This week", "week", true],
        ["This month", "month", true],
        ["Overall", "overall", true],
      ] as const
    ).map(([name, key, long]) => ({ name, tally: periods[key], long })),
  ];

  const time = (t: Tally | null, long: boolean) => (t ? (long ? hours(t.seconds) : clock(t.seconds)) : "—");

  return (
    <section aria-label="Numbers" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div
          className="flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-0.5 text-sm"
          role="group"
          aria-label="Of"
        >
          {SCOPES.map(({ scope: s, name }) => (
            <button
              key={s}
              type="button"
              disabled={!available[s]}
              aria-pressed={scope === s}
              onClick={() => {
                setChosen(s);
                saveScope(s);
              }}
              className={`rounded-md px-3 py-1 disabled:text-zinc-300 dark:disabled:text-zinc-600 ${
                scope === s
                  ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
        <span className="min-w-0 truncate text-sm font-medium text-zinc-700 dark:text-zinc-300" title={label}>
          {label}
        </span>
      </div>
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-800 text-left text-xs text-zinc-400 dark:text-zinc-500">
            <th className="w-[31%] pb-1" />
            <th className="pb-1 font-normal">Time</th>
            <th className="pb-1 font-normal">
              <abbr title="Interruptions: every play/stop" className="no-underline">
                Interr.
              </abbr>
            </th>
            <th className="pb-1 font-normal">
              <abbr title="The longest uninterrupted work: one session, from Play to Stop" className="no-underline">
                Longest
              </abbr>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-b border-zinc-100 dark:border-zinc-800 last:border-0">
              <th scope="row" className="py-1.5 pr-2 text-left font-normal text-zinc-500 dark:text-zinc-400">
                {row.name}
              </th>
              <Cell>{time(row.tally, row.long)}</Cell>
              <Cell muted>{row.tally && !row.first ? row.tally.sessions.toLocaleString() : "—"}</Cell>
              <Cell muted>{row.tally && row.tally.sessions > 0 ? clock(row.tally.longest) : "—"}</Cell>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Cell({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <td
      className={`py-1.5 tabular-nums ${muted ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-800 dark:text-zinc-100"}`}
    >
      {children}
    </td>
  );
}

const HOUR = 3600;

interface EstimateBarProps {
  project: Project;
  periods: Periods;
  /** the day the periods are about */
  day: string;
  /** the running session, if it is this project's */
  running: Session | null;
  skew: number;
  onOpen: () => void;
  onEstimate: (seconds: number) => void;
}

/** How much of the project's estimate the time spent on it has used up. */
function EstimateBar({ project, periods, day, running, skew, onOpen, onEstimate }: EstimateBarProps) {
  const now = useSecond(!!running) + skew;
  const done = livePeriods(periods, running, now, day).overall.seconds;
  const estimate = project.estimate;
  if (estimate === null) {
    return (
      <p className="-my-4 text-center text-sm">
        <button
          type="button"
          className="text-sky-700 dark:text-sky-400 underline hover:text-sky-900 dark:hover:text-sky-300"
          onClick={onOpen}
        >
          Set an estimate for {project.name}
        </button>
      </p>
    );
  }
  const over = done > estimate;
  return (
    <section aria-label="Estimate" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="text-zinc-700 dark:text-zinc-300">
          {hours(done)} of {hours(estimate)}
          <span className={over ? "text-rose-700 dark:text-rose-400" : "text-zinc-500 dark:text-zinc-400"}>
            {" · "}
            {over ? `${hours(done - estimate)} over` : `${hours(estimate - done)} left`}
          </span>
        </span>
        <span className="flex gap-1">
          <button
            type="button"
            className={`${secondaryButton} px-2 py-1 text-xs`}
            disabled={estimate - HOUR < 60}
            onClick={() => onEstimate(estimate - HOUR)}
            title="Shorten the estimate by an hour"
          >
            −1h
          </button>
          <button
            type="button"
            className={`${secondaryButton} px-2 py-1 text-xs`}
            onClick={() => onEstimate(estimate + HOUR)}
            title="Lengthen the estimate by an hour"
          >
            +1h
          </button>
          <button type="button" className={`${secondaryButton} px-2 py-1 text-xs`} onClick={onOpen}>
            Change…
          </button>
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={estimate}
        aria-valuenow={Math.min(done, estimate)}
        aria-label={`${project.name}: time spent of the estimate`}
      >
        <div
          className={`h-full rounded-full ${over ? "bg-rose-500" : "bg-sky-600"}`}
          style={{ width: `${Math.min(100, (done / estimate) * 100)}%` }}
        />
      </div>
    </section>
  );
}
