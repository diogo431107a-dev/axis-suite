import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths, monthStart } from "../../shared/dates.ts";
import type { DaySummary } from "../../shared/protocol.ts";
import { api, query } from "../api.ts";
import { MOOD_COLORS, NO_MOOD } from "../colors.ts";
import { monthName, weekdayNames } from "../format.ts";
import { go } from "../nav.ts";
import { iconButton } from "../ui/buttons.ts";
import { byDay, dayMood, monthGrid } from "./calendar.ts";

interface MiniCalendarProps {
  journalId: string;
  /** the day shown; the calendar opens on its month */
  date: string;
  today: string;
  weekStart: number;
  revision: number;
  onPick?: () => void;
  onError: (err: unknown) => void;
}

/** A month in the sidebar: a dot under each day written, in the colour of its mood. */
export function MiniCalendar({ journalId, date, today, weekStart, revision, onPick, onError }: MiniCalendarProps) {
  const [month, setMonth] = useState(monthStart(date));
  const [days, setDays] = useState<DaySummary[]>([]);

  // Following the day shown to another month.
  useEffect(() => setMonth(monthStart(date)), [date]);

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

  return (
    <div className="px-3 select-none">
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          className={iconButton}
          aria-label="Previous month"
          onClick={() => setMonth(addMonths(month, -1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-xs font-medium text-stone-600">{monthName(month)}</span>
        <button
          type="button"
          className={iconButton}
          aria-label="Next month"
          onClick={() => setMonth(addMonths(month, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] text-stone-400">
        {weekdayNames(weekStart).map((name) => (
          <span key={name}>{name.slice(0, 2)}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 text-center text-xs">
        {weeks.flat().map((day) => {
          const written = pages.get(day);
          const mood = dayMood(written);
          const outside = day.slice(0, 7) !== month.slice(0, 7);
          return (
            <button
              key={day}
              type="button"
              disabled={day > today}
              onClick={() => {
                onPick?.();
                go({ kind: "day", journalId, date: day });
              }}
              aria-label={day}
              aria-current={day === date ? "date" : undefined}
              className={`relative flex h-7 flex-col items-center justify-center rounded-md enabled:hover:bg-stone-200/70
                ${day === date ? "bg-amber-100 font-semibold text-amber-900" : outside || day > today ? "text-stone-300" : "text-stone-600"}
                ${day === today && day !== date ? "font-semibold text-amber-800" : ""}`}
            >
              {Number(day.slice(8))}
              {written && (
                <span
                  className={`absolute bottom-0.5 h-1 w-1 rounded-full ${mood ? MOOD_COLORS[mood].bg : NO_MOOD}`}
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
