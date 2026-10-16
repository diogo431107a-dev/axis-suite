import { useEffect, type ReactNode } from "react";
import { Play, Square } from "lucide-react";
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
        <p className="min-h-5 text-center text-sm text-zinc-500">
          <Hint state={state} today={today} />
        </p>
      </section>

      {state && <Resume tasks={tasks} running={running} busy={busy} onResume={(task) => void timer.resume(task)} />}

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
          running={running?.projectId === project.id ? running : null}
          skew={timer.skew}
          onOpen={() => onOpenProject(project)}
          onEstimate={(seconds) => onEstimate(project, seconds)}
        />
      )}

      {state && <Stats state={state} today={today} skew={timer.skew} />}

      {state && state.unnamed > 0 && (
        <p className="text-center text-sm">
          <Link to={{ kind: "history", unnamed: true }} className="text-sky-700 underline hover:text-sky-900">
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
      className={`font-light tracking-tight tabular-nums text-7xl sm:text-8xl ${running ? "text-zinc-900" : "text-zinc-300"}`}
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
  onResume: (task: Task) => void;
}

/** The latest tasks, each started again with one click and its last tags; a running session stops for it. */
function Resume({ tasks, running, busy, onResume }: ResumeProps) {
  const recent = tasks
    .filter((t) => (t.name !== null || t.project !== null) && !(running && isOf(t, running)))
    .slice(0, 5);
  if (recent.length === 0) return null;
  return (
    <section aria-labelledby="resume-heading" className="-mt-2">
      <h2 id="resume-heading" className={label}>
        Resume
      </h2>
      <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
        {recent.map((t) => (
          <li key={`${t.projectId}\n${t.name}`}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onResume(t)}
              title={running ? "Stop the running session and start this one" : "Start this one"}
              className="flex w-full items-baseline gap-3 px-3 py-2 text-left text-sm hover:bg-zinc-50
                         focus:outline-none focus-visible:bg-zinc-50 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5 shrink-0 self-center text-sky-700" fill="currentColor" aria-hidden />
              <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                <span className="min-w-0 break-words text-zinc-800">{t.name ?? t.project}</span>
                {t.name !== null && t.project !== null && <span className="text-zinc-500">{t.project}</span>}
                {t.lastTags.map((tag) => (
                  <span key={tag} className="text-zinc-400">
                    #{tag}
                  </span>
                ))}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Time and interruptions: for the session, the day, its week and month, and ever. */
function Stats({ state, today, skew }: { state: TimerState; today: string; skew: number }) {
  const running = state.running;
  const now = useSecond(!!running) + skew;
  const all = livePeriods(state.all, running, now);
  const project = state.project;
  const mine = (s: Session | null) => !!s && !!project && s.projectId === project.id;
  const own = project ? livePeriods(project.periods, mine(running) ? running : null, now) : null;
  const session = running ?? state.last;
  const sessionSeconds = running ? elapsed(running, now) : (state.last?.seconds ?? 0);

  const rows: { name: string; all: Tally | null; own: Tally | null; long: boolean }[] = [
    {
      name: running ? "This session" : "Last session",
      all: session ? { seconds: sessionSeconds, sessions: 1 } : null,
      own: mine(session) ? { seconds: sessionSeconds, sessions: 1 } : null,
      long: false,
    },
    ...(
      [
        [state.day === today ? "Today" : dayShort(state.day), "today", false],
        ["This week", "week", true],
        ["This month", "month", true],
        ["Overall", "overall", true],
      ] as const
    ).map(([name, key, long]) => ({ name, all: all[key], own: own?.[key] ?? null, long })),
  ];

  const time = (t: Tally | null, long: boolean) => (t ? (long ? hours(t.seconds) : clock(t.seconds)) : "—");
  const count = (t: Tally | null, first: boolean) => (t && !first ? t.sessions.toLocaleString() : "—");

  return (
    <table className="w-full table-fixed text-sm">
      <thead>
        <tr className="text-left text-xs font-medium text-zinc-500">
          <th className="w-[28%] pb-1 font-medium" />
          {project && (
            <th colSpan={2} className="truncate pb-1 font-medium text-zinc-700" title={project.name}>
              {project.name}
            </th>
          )}
          <th colSpan={2} className="pb-1 font-medium text-zinc-700">
            All projects
          </th>
        </tr>
        <tr className="border-b border-zinc-200 text-left text-xs text-zinc-400">
          <th />
          {project && <Heads />}
          <Heads />
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={row.name} className="border-b border-zinc-100 last:border-0">
            <th scope="row" className="py-1.5 pr-2 text-left font-normal text-zinc-500">
              {row.name}
            </th>
            {project && (
              <>
                <Cell>{time(row.own, row.long)}</Cell>
                <Cell muted>{count(row.own, i === 0)}</Cell>
              </>
            )}
            <Cell>{time(row.all, row.long)}</Cell>
            <Cell muted>{count(row.all, i === 0)}</Cell>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Heads() {
  return (
    <>
      <th className="pb-1 font-normal">Time</th>
      <th className="pb-1 font-normal">
        <abbr title="Interruptions: every play/stop" className="no-underline">
          Interr.
        </abbr>
      </th>
    </>
  );
}

function Cell({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <td className={`py-1.5 tabular-nums ${muted ? "text-zinc-500" : "text-zinc-800"}`}>{children}</td>;
}

const HOUR = 3600;

interface EstimateBarProps {
  project: Project;
  periods: Periods;
  /** the running session, if it is this project's */
  running: Session | null;
  skew: number;
  onOpen: () => void;
  onEstimate: (seconds: number) => void;
}

/** How much of the project's estimate the time spent on it has used up. */
function EstimateBar({ project, periods, running, skew, onOpen, onEstimate }: EstimateBarProps) {
  const now = useSecond(!!running) + skew;
  const done = livePeriods(periods, running, now).overall.seconds;
  const estimate = project.estimate;
  if (estimate === null) {
    return (
      <p className="-my-4 text-center text-sm">
        <button type="button" className="text-sky-700 underline hover:text-sky-900" onClick={onOpen}>
          Set an estimate for {project.name}
        </button>
      </p>
    );
  }
  const over = done > estimate;
  return (
    <section aria-label="Estimate" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="text-zinc-700">
          {hours(done)} of {hours(estimate)}
          <span className={over ? "text-rose-700" : "text-zinc-500"}>
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
        className="h-2 overflow-hidden rounded-full bg-zinc-200"
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
