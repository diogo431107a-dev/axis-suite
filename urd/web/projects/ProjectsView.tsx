import type { Project, Task } from "../../shared/protocol.ts";
import { hours, interruptionsText, sessionsText } from "../format.ts";

interface ProjectsViewProps {
  projects: Project[] | null;
  /** the latest used first */
  tasks: Task[];
  onOpen: (project: Project) => void;
  onOpenTask: (task: Task) => void;
}

/**
 * Every project with its time this week, this month and overall, its estimate and its tasks.
 * Archived ones last; tasks without a project at the end.
 */
export function ProjectsView({ projects, tasks, onOpen, onOpenTask }: ProjectsViewProps) {
  if (!projects) return null;
  const byUse = (a: Project, b: Project) =>
    (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? "") || a.name.localeCompare(b.name);
  const active = projects.filter((p) => !p.archived).sort(byUse);
  const archived = projects.filter((p) => p.archived).sort(byUse);
  const alone = tasks.filter((t) => t.projectId === null);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <h1 className="mb-1 text-lg font-semibold text-zinc-800">Projects</h1>
      <p className="mb-4 text-sm text-zinc-500">
        A project is made when a session is first given its name, and goes once nothing is left in it (no session, no
        estimate). Its tasks are listed in the order they were started. Interruptions count every play/stop.
      </p>
      {projects.length === 0 && alone.length === 0 && <p className="text-sm text-zinc-500">No projects yet.</p>}
      <ProjectList projects={active} tasks={tasks} onOpen={onOpen} onOpenTask={onOpenTask} />
      {alone.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-1 px-1 text-sm font-medium text-zinc-700">No project</h2>
          <div className="rounded-xl border border-zinc-200 bg-white py-1">
            <TaskList tasks={alone} onOpen={onOpenTask} />
          </div>
        </section>
      )}
      {archived.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-medium text-zinc-500">Archived ({archived.length})</summary>
          <div className="mt-2">
            <ProjectList projects={archived} tasks={tasks} onOpen={onOpen} onOpenTask={onOpenTask} />
          </div>
        </details>
      )}
    </div>
  );
}

interface ProjectListProps {
  projects: Project[];
  tasks: Task[];
  onOpen: (project: Project) => void;
  onOpenTask: (task: Task) => void;
}

function ProjectList({ projects, tasks, onOpen, onOpenTask }: ProjectListProps) {
  if (projects.length === 0) return null;
  return (
    <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
      {projects.map((p) => {
        const { week, month, overall } = p.periods;
        const own = tasks.filter((t) => t.projectId === p.id);
        return (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onOpen(p)}
              className="flex w-full flex-col gap-1.5 px-4 py-3 text-left hover:bg-zinc-50 focus:outline-none focus-visible:bg-zinc-50"
            >
              <span className="flex w-full items-baseline justify-between gap-3">
                <span className="truncate font-medium text-zinc-800">{p.name}</span>
                <span className="shrink-0 text-sm tabular-nums text-zinc-700">{hours(overall.seconds)}</span>
              </span>
              <span className="flex flex-wrap gap-x-4 text-xs text-zinc-500 tabular-nums">
                <span>This week {hours(week.seconds)}</span>
                <span>This month {hours(month.seconds)}</span>
                <span>{sessionsText(overall.sessions)}</span>
              </span>
              {p.estimate !== null && (
                <EstimateLine done={overall.seconds} estimate={p.estimate} changes={p.estimateLog.length} />
              )}
            </button>
            {/* Only the sessions without a task: nothing to break down. */}
            {own.some((t) => t.name !== null) && (
              <div className="pb-2">
                <TaskList tasks={own} onOpen={onOpenTask} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A project's tasks: its sessions without a task first, then the tasks in the order they were started. */
function TaskList({ tasks, onOpen }: { tasks: Task[]; onOpen: (task: Task) => void }) {
  const ordered = [...tasks].sort(
    (a, b) => Number(a.name !== null) - Number(b.name !== null) || a.firstStartedAt.localeCompare(b.firstStartedAt),
  );
  return (
    <ul>
      {ordered.map((t) => (
        <li key={t.name ?? ""}>
          <button
            type="button"
            onClick={() => onOpen(t)}
            className="flex w-full items-baseline gap-3 py-1 pr-4 pl-8 text-left text-sm hover:bg-zinc-50
                       focus:outline-none focus-visible:bg-zinc-50"
          >
            <span
              className={`min-w-0 flex-1 break-words ${t.name === null ? "italic text-zinc-400" : "text-zinc-700"}`}
            >
              {t.name ?? "No task"}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-zinc-500">
              {hours(t.periods.overall.seconds)} · {interruptionsText(t.periods.overall.sessions)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function EstimateLine({ done, estimate, changes }: { done: number; estimate: number; changes: number }) {
  const over = done > estimate;
  return (
    <span className="flex w-full items-center gap-3 text-xs">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200">
        <span
          className={`block h-full rounded-full ${over ? "bg-rose-500" : "bg-sky-600"}`}
          style={{ width: `${Math.min(100, (done / estimate) * 100)}%` }}
        />
      </span>
      <span className={`shrink-0 tabular-nums ${over ? "text-rose-700" : "text-zinc-500"}`}>
        {over ? `${hours(done - estimate)} over` : `${hours(estimate - done)} left`} of {hours(estimate)}
        {changes > 1 && ` · revised ${changes - 1}×`}
      </span>
    </span>
  );
}
