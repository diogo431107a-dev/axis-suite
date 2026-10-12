import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths, monthStart } from "../../shared/dates.ts";
import type { DaySummary, Journal } from "../../shared/protocol.ts";
import { api, query } from "../api.ts";
import { JOURNAL_COLORS, MOOD_COLORS, NO_MOOD } from "../colors.ts";
import { monthName, weekdayNames } from "../format.ts";
import { go } from "../nav.ts";
import { iconButton, secondaryButton } from "../ui/buttons.ts";
import { JournalFilter } from "../ui/JournalFilter.tsx";
import { Link } from "../ui/Link.tsx";
import { byDay, dayMood, monthGrid } from "./calendar.ts";

interface MonthViewProps {
  journals: Journal[];
  /** null: all journals */
  journalId: string | null;
  month: string;
  today: string;
  weekStart: number;
  /** where a day without a page opens */
  defaultJournal: Journal;
  revision: number;
  onError: (err: unknown) => void;
}

/** A month of pages: each day with its mood and the start of its text. */
export function MonthView({
  journals,
  journalId,
  month,
  today,
  weekStart,
  defaultJournal,
  revision,
  onError,
}: MonthViewProps) {
  const [days, setDays] = useState<DaySummary[]>([]);
  const weeks = useMemo(() => monthGrid(month, weekStart), [month, weekStart]);
  const from = weeks[0]![0]!;
  const to = weeks.at(-1)![6]!;

  useEffect(() => {
    let stale = false;
    api<DaySummary[]>(`/api/days${query({ from, to, journal: journalId })}`).then(
      (list) => !stale && setDays(list),
      (err: unknown) => !stale && onError(err),
    );
    return () => {
      stale = true;
    };
  }, [from, to, journalId, revision, onError]);

  const pages = useMemo(() => byDay(days), [days]);
  const byId = new Map(journals.map((j) => [j.id, j]));
  const show = (m: string, j = journalId) => go({ kind: "month", month: m, journalId: j }, j !== journalId);
  const written = days.filter((d) => d.date.slice(0, 7) === month.slice(0, 7)).length;

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8">
      <header className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={iconButton}
          aria-label="Previous month"
          onClick={() => show(addMonths(month, -1))}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button type="button" className={iconButton} aria-label="Next month" onClick={() => show(addMonths(month, 1))}>
          <ChevronRight className="h-5 w-5" />
        </button>
        <h1 className="font-serif text-2xl text-stone-900">{monthName(month)}</h1>
        <span className="text-sm text-stone-400">{written === 1 ? "1 page" : `${written} pages`}</span>
        <div className="ml-auto flex items-center gap-2">
          {monthStart(today) !== monthStart(month) && (
            <button type="button" className={secondaryButton} onClick={() => show(monthStart(today))}>
              This month
            </button>
          )}
          <JournalFilter journals={journals} value={journalId} onChange={(j) => show(month, j)} />
        </div>
      </header>

      <div className="grid grid-cols-7 border-b border-stone-200 pb-1 text-center text-xs text-stone-400">
        {weekdayNames(weekStart).map((name) => (
          <span key={name}>{name}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-b-lg bg-stone-200">
        {weeks.flat().map((day) => {
          const list = pages.get(day) ?? [];
          const mood = dayMood(list);
          const outside = day.slice(0, 7) !== month.slice(0, 7);
          const target =
            byId.get(list[0]?.journalId ?? "") ?? (journalId ? byId.get(journalId) : undefined) ?? defaultJournal;
          return (
            <Link
              key={day}
              to={{ kind: "day", journalId: target.id, date: day }}
              className={`group flex min-h-16 flex-col gap-1 p-1.5 sm:min-h-28 sm:p-2 ${outside ? "bg-stone-50" : "bg-white"} hover:bg-amber-50/60`}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={`text-xs ${
                    day === today
                      ? "rounded-full bg-amber-700 px-1.5 font-semibold text-white"
                      : outside
                        ? "text-stone-300"
                        : "text-stone-500"
                  }`}
                >
                  {Number(day.slice(8))}
                </span>
                {list.length > 0 && (
                  <span className={`h-2 w-2 rounded-full ${mood ? MOOD_COLORS[mood].bg : NO_MOOD}`} aria-hidden />
                )}
              </span>
              {list.slice(0, 2).map((p) => {
                const journal = byId.get(p.journalId);
                return (
                  <span
                    key={p.journalId}
                    className="hidden items-start gap-1 text-left text-xs leading-snug text-stone-600 sm:flex"
                  >
                    {!journalId && journals.length > 1 && journal && (
                      <span
                        className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${JOURNAL_COLORS[journal.color].dot}`}
                        aria-hidden
                      />
                    )}
                    <span className="line-clamp-3 font-serif">{p.preview || "…"}</span>
                  </span>
                );
              })}
              {list.length > 2 && (
                <span className="hidden text-[10px] text-stone-400 sm:block">+{list.length - 2} more</span>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
