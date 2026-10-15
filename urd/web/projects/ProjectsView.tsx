import type { Project } from "../../shared/protocol.ts";
import { hours, sessionsText } from "../format.ts";

interface ProjectsViewProps {
  projects: Project[] | null;
  onOpen: (project: Project) => void;
}

/** Every project with its time this week, this month and overall, and its estimate. Archived ones last. */
export function ProjectsView({ projects, onOpen }: ProjectsViewProps) {
  if (!projects) return null;
  const byUse = (a: Project, b: Project) =>
    (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? "") || a.name.localeCompare(b.name);
  const active = projects.filter((p) => !p.archived).sort(byUse);
  const archived = projects.filter((p) => p.archived).sort(byUse);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <h1 className="mb-1 text-lg font-semibold text-zinc-800">Projects</h1>
      <p className="mb-4 text-sm text-zinc-500">
        A project is made when a session is first given its name, and goes once nothing is left in it (no session, no
        estimate). Interruptions count every play/stop.
      </p>
      {projects.length === 0 && <p className="text-sm text-zinc-500">No projects yet.</p>}
      <ProjectList projects={active} onOpen={onOpen} />
      {archived.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-medium text-zinc-500">Archived ({archived.length})</summary>
          <div className="mt-2">
            <ProjectList projects={archived} onOpen={onOpen} />
          </div>
        </details>
      )}
    </div>
  );
}

function ProjectList({ projects, onOpen }: { projects: Project[]; onOpen: (project: Project) => void }) {
  return (
    <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
      {projects.map((p) => {
        const { week, month, overall } = p.periods;
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
          </li>
        );
      })}
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
