import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import type { HistoryPage, Project, Session, TagCount, Task } from "../../shared/protocol.ts";
import { daySpans } from "../../shared/days.ts";
import { api, query } from "../api.ts";
import { elapsed, endOf, useSecond } from "../clock.ts";
import { clock, dayShort, dayTitle, sessionsText, timeOfDay } from "../format.ts";
import { Link } from "../ui/Link.tsx";
import { secondaryButton } from "../ui/buttons.ts";
import { SessionDialog } from "./SessionDialog.tsx";

interface HistoryViewProps {
  unnamed: boolean;
  /** sessions with neither a project nor a task, for the filter's label */
  unnamedCount: number;
  projects: Project[];
  tasks: Task[];
  tags: TagCount[];
  skew: number;
  /** goes up when the server says something changed */
  revision: number;
  onChanged: () => void;
  onError: (err: unknown) => void;
}

/** Sessions by day, newest first: to name them, shorten them or delete them. */
export function HistoryView({
  unnamed,
  unnamedCount,
  projects,
  tasks,
  tags,
  skew,
  revision,
  onChanged,
  onError,
}: HistoryViewProps) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [dayList, setDayList] = useState<string[]>([]);
  const [next, setNext] = useState<string | null>(null);
  // How many pages are shown; a change reloads all of them.
  const [pages, setPages] = useState(1);
  const [open, setOpen] = useState<Session | null>(null);

  useEffect(() => {
    let stale = false;
    (async () => {
      // A session past midnight can be on two pages: it is kept once.
      const all = new Map<string, Session>();
      let shownDays: string[] = [];
      let before: string | null = null;
      for (let i = 0; i < pages; i++) {
        const page: HistoryPage = await api<HistoryPage>(
          `/api/sessions${query({ before, unnamed: unnamed ? "1" : null })}`,
        );
        for (const s of page.sessions) all.set(s.id, s);
        shownDays = shownDays.concat(page.days);
        before = page.next;
        if (!before) break;
      }
      if (stale) return;
      setSessions([...all.values()]);
      setDayList(shownDays);
      setNext(before);
    })().catch((err: unknown) => !stale && onError(err));
    return () => {
      stale = true;
    };
  }, [unnamed, pages, revision, onError]);

  // Each session on every shown day it has time in, newest first.
  const days = useMemo(() => {
    const groups = dayList.map((day) => ({ day, sessions: [] as Session[] }));
    const byDay = new Map(groups.map((g) => [g.day, g]));
    const now = Date.now();
    for (const s of sessions ?? []) {
      for (const span of spansOf(s, now)) byDay.get(span.day)?.sessions.push(s);
    }
    return groups.filter((g) => g.sessions.length > 0);
  }, [sessions, dayList]);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold text-zinc-800 dark:text-zinc-100">History</h1>
        <nav
          className="flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-0.5 text-sm"
          aria-label="Filter"
        >
          <Link
            to={{ kind: "history", unnamed: false }}
            className={`rounded-md px-3 py-1 ${unnamed ? "text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100"}`}
          >
            All
          </Link>
          <Link
            to={{ kind: "history", unnamed: true }}
            className={`rounded-md px-3 py-1 ${unnamed ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100"}`}
          >
            Unnamed{unnamedCount > 0 ? ` (${unnamedCount})` : ""}
          </Link>
        </nav>
        <a
          href="/api/export.csv"
          download
          className={`${secondaryButton} py-1`}
          title="Every session, for a spreadsheet"
        >
          <Download className="h-4 w-4" />
          CSV
        </a>
      </div>

      {sessions && sessions.length === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {unnamed ? "Every session has a project or a task." : "No sessions yet."}
        </p>
      )}

      <div className="flex flex-col gap-5">
        {days.map(({ day, sessions: list }) => (
          <section key={day}>
            <h2 className="mb-1 flex items-baseline justify-between gap-3 px-1 text-sm">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">{dayTitle(day)}</span>
              <DayTotal day={day} sessions={list} skew={skew} />
            </h2>
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
              {list.map((s) => (
                <li key={s.id}>
                  <SessionRow session={s} day={day} skew={skew} onOpen={() => setOpen(s)} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {next && (
        <div className="mt-6 text-center">
          <button type="button" className={secondaryButton} onClick={() => setPages((n) => n + 1)}>
            Show older days
          </button>
        </div>
      )}

      {open && (
        <SessionDialog
          session={open}
          projects={projects}
          tasks={tasks}
          tags={tags}
          onChanged={onChanged}
          onError={onError}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

/** A session's time split between the days it has time in, up to `nowMs` while it runs. */
const spansOf = (s: Session, nowMs: number) => daySpans(Date.parse(s.startedAt), endOf(s, nowMs), s.zone);

/** The part of a session's time that fell in `day`. */
const partIn = (s: Session, day: string, nowMs: number) =>
  spansOf(s, nowMs).find((span) => span.day === day)?.seconds ?? 0;

function DayTotal({ day, sessions, skew }: { day: string; sessions: Session[]; skew: number }) {
  const running = sessions.some((s) => s.endedAt === null);
  const now = useSecond(running) + skew;
  const total = sessions.reduce((sum, s) => sum + partIn(s, day, now), 0);
  return (
    <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
      {clock(total)} · {sessionsText(sessions.length)}
    </span>
  );
}

interface SessionRowProps {
  session: Session;
  /** the day it is listed under: only its part in that day is counted there */
  day: string;
  skew: number;
  onOpen: () => void;
}

function SessionRow({ session: s, day, skew, onOpen }: SessionRowProps) {
  const running = s.endedAt === null;
  const now = useSecond(running) + skew;
  const spans = spansOf(s, now);
  const part = spans.find((span) => span.day === day)?.seconds ?? 0;
  const continues = spans.at(-1)!.day > day;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid w-full grid-cols-[auto_1fr_auto] items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 text-left text-sm
                 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 focus:outline-none focus-visible:bg-zinc-50 dark:focus-visible:bg-zinc-800/60"
    >
      <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
        {timeOfDay(s.startedAt)}–{running ? "now" : timeOfDay(s.endedAt!)}
      </span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {s.task && <span className="min-w-0 break-words text-zinc-800 dark:text-zinc-100">{s.task}</span>}
        {s.project && (
          <span
            className={`min-w-0 break-words ${s.task ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-800 dark:text-zinc-100"}`}
          >
            {s.project}
          </span>
        )}
        {!s.task && !s.project && <span className="italic text-zinc-400 dark:text-zinc-500">Unnamed</span>}
        {s.tags.map((t) => (
          <span key={t} className="text-zinc-500 dark:text-zinc-400">
            #{t}
          </span>
        ))}
        {s.day < day && (
          <span className="whitespace-nowrap rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-600 dark:text-zinc-300">
            from {dayShort(s.day)}
          </span>
        )}
        {continues && (
          <span className="whitespace-nowrap rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-600 dark:text-zinc-300">
            continues past midnight
          </span>
        )}
        {running && (
          <span className="rounded bg-rose-50 dark:bg-rose-950 px-1.5 py-0.5 text-xs text-rose-700 dark:text-rose-400">
            running
          </span>
        )}
        {s.stop === "auto" && (
          <span
            className="whitespace-nowrap rounded bg-amber-50 dark:bg-amber-950 px-1.5 py-0.5 text-xs text-amber-800 dark:text-amber-200"
            title="Before Urd 2.0.0, a session nobody stopped stopped by itself"
          >
            stopped by itself
          </span>
        )}
      </span>
      <span
        className="tabular-nums text-zinc-800 dark:text-zinc-100"
        title={spans.length > 1 ? `${clock(elapsed(s, now))} in all, ${clock(part)} on this day` : undefined}
      >
        {clock(part)}
      </span>
    </button>
  );
}
