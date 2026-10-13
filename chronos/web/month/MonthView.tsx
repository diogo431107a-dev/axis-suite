import { ChevronLeft, ChevronRight } from "lucide-react";
import { WEEKDAYS, addMonths, monthOf, monthWeeks, weekLabel } from "../../shared/dates.ts";
import type { CalEvent, Calendar } from "../../shared/protocol.ts";
import { CAL_COLORS } from "../colors.ts";
import { timeOf, whenText } from "../format.ts";
import { iconButton, secondaryButton } from "../ui/buttons.ts";
import { layoutWeek } from "./layout.ts";

interface MonthViewProps {
  month: string;
  today: string;
  zone: string;
  /** the events of the weeks shown, hidden calendars left out; null while loading */
  events: CalEvent[] | null;
  calendars: ReadonlyMap<string, Calendar>;
  onMonth: (month: string) => void;
  onOpen: (event: CalEvent) => void;
  onNew: (date: string) => void;
  onDay: (date: string) => void;
}

/** Rows a day has room for, bars and lines together; beyond that, "+N more". */
const ROWS = 4;

/** A month as weeks (Monday first, ISO week numbers down the side), with each day's events. */
export function MonthView({ month, today, zone, events, calendars, onMonth, onOpen, onNew, onDay }: MonthViewProps) {
  const weeks = monthWeeks(month);
  const colorOf = (e: CalEvent) => CAL_COLORS[calendars.get(e.calendarId)?.color ?? "stone"];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-4 py-2">
        <h1 className="mr-2 text-lg font-semibold text-stone-800 tabular-nums">{month}</h1>
        <button
          type="button"
          className={iconButton}
          aria-label="Previous month"
          onClick={() => onMonth(addMonths(month, -1))}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          className={iconButton}
          aria-label="Next month"
          onClick={() => onMonth(addMonths(month, 1))}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
        <button
          type="button"
          className={`${secondaryButton} py-1`}
          disabled={monthOf(today) === month}
          onClick={() => onMonth(monthOf(today))}
        >
          Today
        </button>
        {events === null && <span className="text-xs text-stone-400">Loading…</span>}
      </header>

      <div className="grid grid-cols-[2.25rem_repeat(7,minmax(0,1fr))] border-b border-stone-200 text-xs text-stone-500">
        <div className="px-1 py-1 text-center" title="ISO week">
          Wk
        </div>
        {WEEKDAYS.map((d) => (
          <div key={d} className="border-l border-stone-200 px-2 py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {weeks.map((week) => {
          const layout = layoutWeek(week, events ?? [], zone);
          const lanesShown = Math.min(layout.lanes, ROWS);
          return (
            <div
              key={week[0]}
              className="grid min-h-[6.5rem] flex-1 grid-cols-[2.25rem_repeat(7,minmax(0,1fr))] border-b border-stone-200"
            >
              <div className="pt-1.5 text-center text-[11px] text-stone-400 tabular-nums" title={weekLabel(week[0]!)}>
                {weekLabel(week[0]!).slice(6)}
              </div>
              <div
                className="relative col-span-7 grid grid-cols-7 content-start"
                style={{ gridTemplateRows: `1.75rem repeat(${ROWS}, 1.375rem) minmax(0, 1fr)` }}
              >
                {/* The days: clicking one makes an event on it. */}
                {week.map((date, i) => (
                  <div
                    key={date}
                    role="button"
                    tabIndex={-1}
                    aria-label={`New event on ${date}`}
                    onClick={() => onNew(date)}
                    style={{ gridColumn: i + 1, gridRow: "1 / -1" }}
                    className={`cursor-pointer border-l border-stone-200 ${
                      monthOf(date) !== month ? "bg-stone-100/70" : ""
                    } hover:bg-indigo-50/40`}
                  />
                ))}
                {week.map((date, i) => (
                  <div key={`n${date}`} style={{ gridColumn: i + 1, gridRow: 1 }} className="z-10 px-1 pt-1">
                    <button
                      type="button"
                      onClick={() => onDay(date)}
                      title={`${date}: every event`}
                      className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs tabular-nums ${
                        date === today
                          ? "bg-indigo-600 font-semibold text-white"
                          : monthOf(date) !== month
                            ? "text-stone-400 hover:bg-stone-200"
                            : "text-stone-700 hover:bg-stone-200"
                      }`}
                    >
                      {date.slice(8) === "01" ? date.slice(5) : Number(date.slice(8))}
                    </button>
                  </div>
                ))}

                {layout.bars
                  .filter((b) => b.lane < lanesShown)
                  .map((b) => {
                    const c = colorOf(b.event);
                    const timed = !b.event.allDay;
                    return (
                      <button
                        key={b.event.id}
                        type="button"
                        onClick={() => onOpen(b.event)}
                        title={`${b.event.title}\n${whenText(b.event, zone)}`}
                        style={{ gridColumn: `${b.col + 1} / span ${b.span}`, gridRow: b.lane + 2 }}
                        className={`z-10 mx-0.5 my-px truncate px-1.5 text-left text-xs leading-5 ${c.bar} ${
                          b.before ? "rounded-l-none" : "rounded-l"
                        } ${b.after ? "rounded-r-none" : "rounded-r"}`}
                      >
                        {timed && !b.before && (
                          <span className="mr-1 tabular-nums opacity-80">{timeOf(b.event.start, zone)}</span>
                        )}
                        {b.event.title}
                      </button>
                    );
                  })}

                {week.map((date, i) => {
                  const lines = layout.lines[i]!;
                  // Bars hidden on this day, for lack of lanes.
                  const hiddenBars = layout.bars.filter(
                    (b) => b.lane >= lanesShown && b.col <= i && i < b.col + b.span,
                  ).length;
                  const room = ROWS - lanesShown;
                  const total = lines.length + hiddenBars;
                  const shown = total > room ? Math.max(room - 1, 0) : lines.length;
                  const more = total - shown;
                  return [
                    ...lines.slice(0, shown).map((e, k) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => onOpen(e)}
                        title={`${e.title}\n${whenText(e, zone)}`}
                        style={{ gridColumn: i + 1, gridRow: lanesShown + k + 2 }}
                        className="z-10 mx-0.5 flex min-w-0 items-center gap-1 rounded px-1 text-left text-xs leading-5 text-stone-700 hover:bg-stone-200/70"
                      >
                        <span className={`h-2 w-2 shrink-0 rounded-full ${colorOf(e).dot}`} aria-hidden />
                        <span className="shrink-0 text-stone-500 tabular-nums">{timeOf(e.start, zone)}</span>
                        <span className="truncate">{e.title}</span>
                      </button>
                    )),
                    more > 0 && (
                      <button
                        key={`more${date}`}
                        type="button"
                        onClick={() => onDay(date)}
                        style={{ gridColumn: i + 1, gridRow: lanesShown + shown + 2 }}
                        className="z-10 mx-0.5 rounded px-1 text-left text-xs leading-5 font-medium text-stone-500 hover:bg-stone-200/70"
                      >
                        +{more} more
                      </button>
                    ),
                  ];
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
