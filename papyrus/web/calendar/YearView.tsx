import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { daysInMonth } from "../../shared/dates.ts";
import { MOOD_NAMES, type DaySummary, type Journal, type Mood } from "../../shared/protocol.ts";
import { api, query } from "../api.ts";
import { MOOD_COLORS, NO_MOOD } from "../colors.ts";
import { longDate, shortMonth } from "../format.ts";
import { go } from "../nav.ts";
import { iconButton } from "../ui/buttons.ts";
import { JournalFilter } from "../ui/JournalFilter.tsx";
import { byDay, dayMood } from "./calendar.ts";

interface YearViewProps {
  journals: Journal[];
  /** null: all journals (a day's mood is then their average) */
  journalId: string | null;
  year: number;
  today: string;
  defaultJournal: Journal;
  revision: number;
  onError: (err: unknown) => void;
}

const MOODS: Mood[] = [5, 4, 3, 2, 1];
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const pad = (n: number) => String(n).padStart(2, "0");

/** A year in pixels: one square per day, in the colour of its mood. */
export function YearView({ journals, journalId, year, today, defaultJournal, revision, onError }: YearViewProps) {
  const [days, setDays] = useState<DaySummary[]>([]);

  useEffect(() => {
    let stale = false;
    api<DaySummary[]>(`/api/days${query({ from: `${year}-01-01`, to: `${year}-12-31`, journal: journalId })}`).then(
      (list) => !stale && setDays(list),
      (err: unknown) => !stale && onError(err),
    );
    return () => {
      stale = true;
    };
  }, [year, journalId, revision, onError]);

  const pages = useMemo(() => byDay(days), [days]);
  const counts = useMemo(() => {
    const c = new Map<Mood | null, number>();
    for (const list of pages.values()) {
      const mood = dayMood(list);
      c.set(mood, (c.get(mood) ?? 0) + 1);
    }
    return c;
  }, [pages]);
  const byId = new Map(journals.map((j) => [j.id, j]));
  const show = (y: number, j = journalId) => go({ kind: "year", year: y, journalId: j }, j !== journalId);

  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-8">
      <header className="mb-5 flex flex-wrap items-center gap-2">
        <button type="button" className={iconButton} aria-label="Previous year" onClick={() => show(year - 1)}>
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button type="button" className={iconButton} aria-label="Next year" onClick={() => show(year + 1)}>
          <ChevronRight className="h-5 w-5" />
        </button>
        <h1 className="font-serif text-2xl text-stone-900">{year}</h1>
        <span className="text-sm text-stone-400">
          {pages.size === 1 ? "1 day written" : `${pages.size} days written`}
        </span>
        <div className="ml-auto">
          <JournalFilter journals={journals} value={journalId} onChange={(j) => show(year, j)} />
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="mx-auto border-separate border-spacing-[3px]">
          <thead>
            <tr>
              <th />
              {MONTHS.map((m) => (
                <th key={m} scope="col" className="px-0.5 text-[10px] font-normal text-stone-400">
                  {shortMonth(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAYS.map((d) => (
              <tr key={d}>
                <th scope="row" className="pr-1 text-right text-[10px] font-normal text-stone-300">
                  {d}
                </th>
                {MONTHS.map((m) => {
                  if (d > daysInMonth(year, m)) return <td key={m} />;
                  const date = `${year}-${pad(m)}-${pad(d)}`;
                  const list = pages.get(date);
                  const mood = dayMood(list);
                  const color = list ? (mood ? MOOD_COLORS[mood].bg : NO_MOOD) : "bg-stone-200/70";
                  const target =
                    byId.get(list?.[0]?.journalId ?? "") ??
                    (journalId ? byId.get(journalId) : undefined) ??
                    defaultJournal;
                  const label = `${longDate(date)}${list ? `: ${mood ? MOOD_NAMES[mood] : "written, no mood"}` : ""}`;
                  return (
                    <td key={m} className="p-0">
                      <button
                        type="button"
                        title={label}
                        aria-label={label}
                        disabled={date > today}
                        onClick={() => go({ kind: "day", journalId: target.id, date })}
                        className={`block h-4 w-5 rounded-[3px] sm:h-5 sm:w-8 ${color} enabled:hover:ring-2 enabled:hover:ring-stone-500
                          ${date > today ? "opacity-50" : ""}
                          ${date === today ? "ring-2 ring-amber-700" : ""}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-stone-600">
        {MOODS.map((m) => (
          <li key={m} className="flex items-center gap-1.5">
            <span className={`h-3 w-3 rounded-sm ${MOOD_COLORS[m].bg}`} aria-hidden />
            {MOOD_NAMES[m]} <span className="text-stone-400">{counts.get(m) ?? 0}</span>
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className={`h-3 w-3 rounded-sm ${NO_MOOD}`} aria-hidden />
          No mood <span className="text-stone-400">{counts.get(null) ?? 0}</span>
        </li>
      </ul>
      {!journalId && journals.length > 1 && (
        <p className="mt-2 text-center text-xs text-stone-400">
          With all journals, a day shows the average of their moods.
        </p>
      )}
    </section>
  );
}
