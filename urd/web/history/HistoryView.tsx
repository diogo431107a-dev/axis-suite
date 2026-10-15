import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import type { HistoryPage, Project, Session, TagCount } from "../../shared/protocol.ts";
import { api, query } from "../api.ts";
import { elapsed, useSecond } from "../clock.ts";
import { clock, dayTitle, sessionsText, timeOfDay } from "../format.ts";
import { Link } from "../ui/Link.tsx";
import { secondaryButton } from "../ui/buttons.ts";
import { SessionDialog } from "./SessionDialog.tsx";

interface HistoryViewProps {
  unnamed: boolean;
  /** sessions without a project, for the filter's label */
  unnamedCount: number;
  projects: Project[];
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
  tags,
  skew,
  revision,
  onChanged,
  onError,
}: HistoryViewProps) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  // How many pages are shown; a change reloads all of them.
  const [pages, setPages] = useState(1);
  const [open, setOpen] = useState<Session | null>(null);

  useEffect(() => {
    let stale = false;
    (async () => {
      let all: Session[] = [];
      let before: string | null = null;
      for (let i = 0; i < pages; i++) {
        const page: HistoryPage = await api<HistoryPage>(
          `/api/sessions${query({ before, unnamed: unnamed ? "1" : null })}`,
        );
        all = all.concat(page.sessions);
        before = page.next;
        if (!before) break;
      }
      if (stale) return;
      setSessions(all);
      setNext(before);
    })().catch((err: unknown) => !stale && onError(err));
    return () => {
      stale = true;
    };
  }, [unnamed, pages, revision, onError]);

  const days = useMemo(() => {
    const groups: { day: string; sessions: Session[] }[] = [];
    for (const s of sessions ?? []) {
      const last = groups.at(-1);
      if (last?.day === s.day) last.sessions.push(s);
      else groups.push({ day: s.day, sessions: [s] });
    }
    return groups;
  }, [sessions]);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold text-zinc-800">History</h1>
        <nav className="flex rounded-lg border border-zinc-200 bg-white p-0.5 text-sm" aria-label="Filter">
          <Link
            to={{ kind: "history", unnamed: false }}
            className={`rounded-md px-3 py-1 ${unnamed ? "text-zinc-500 hover:text-zinc-800" : "bg-zinc-100 text-zinc-800"}`}
          >
            All
          </Link>
          <Link
            to={{ kind: "history", unnamed: true }}
            className={`rounded-md px-3 py-1 ${unnamed ? "bg-zinc-100 text-zinc-800" : "text-zinc-500 hover:text-zinc-800"}`}
          >
            Without a project{unnamedCount > 0 ? ` (${unnamedCount})` : ""}
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
        <p className="text-sm text-zinc-500">{unnamed ? "Every session has a project." : "No sessions yet."}</p>
      )}

      <div className="flex flex-col gap-5">
        {days.map(({ day, sessions: list }) => (
          <section key={day}>
            <h2 className="mb-1 flex items-baseline justify-between gap-3 px-1 text-sm">
              <span className="font-medium text-zinc-700">{dayTitle(day)}</span>
              <DayTotal sessions={list} skew={skew} />
            </h2>
            <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
              {list.map((s) => (
                <li key={s.id}>
                  <SessionRow session={s} skew={skew} onOpen={() => setOpen(s)} />
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
          tags={tags}
          onChanged={onChanged}
          onError={onError}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function DayTotal({ sessions, skew }: { sessions: Session[]; skew: number }) {
  const running = sessions.some((s) => s.endedAt === null);
  const now = useSecond(running) + skew;
  const total = sessions.reduce((sum, s) => sum + (s.endedAt === null ? elapsed(s, now) : s.seconds), 0);
  return (
    <span className="tabular-nums text-zinc-500">
      {clock(total)} · {sessionsText(sessions.length)}
    </span>
  );
}

function SessionRow({ session: s, skew, onOpen }: { session: Session; skew: number; onOpen: () => void }) {
  const running = s.endedAt === null;
  const now = useSecond(running) + skew;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid w-full grid-cols-[auto_1fr_auto] items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 text-left text-sm
                 hover:bg-zinc-50 focus:outline-none focus-visible:bg-zinc-50"
    >
      <span className="tabular-nums text-zinc-500">
        {timeOfDay(s.startedAt)}–{running ? "now" : timeOfDay(s.endedAt!)}
      </span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {s.project ? (
          <span className="min-w-0 break-words text-zinc-800">{s.project}</span>
        ) : (
          <span className="italic text-zinc-400">No project</span>
        )}
        {s.tags.map((t) => (
          <span key={t} className="text-zinc-500">
            #{t}
          </span>
        ))}
        {running && <span className="rounded bg-rose-50 px-1.5 py-0.5 text-xs text-rose-700">running</span>}
        {s.stop === "auto" && (
          <span
            className="whitespace-nowrap rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800"
            title="Nobody pressed Stop: it stopped by itself"
          >
            stopped by itself
          </span>
        )}
      </span>
      <span className="tabular-nums text-zinc-800">{clock(running ? elapsed(s, now) : s.seconds)}</span>
    </button>
  );
}
