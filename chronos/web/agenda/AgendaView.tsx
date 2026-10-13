import { useEffect, useRef } from "react";
import { addDays } from "../../shared/dates.ts";
import type { CalEvent, Calendar } from "../../shared/protocol.ts";
import { toWall } from "../../shared/zones.ts";
import { CAL_COLORS } from "../colors.ts";
import { dayHeading } from "../format.ts";
import { secondaryButton } from "../ui/buttons.ts";
import { agendaDays, type AgendaItem } from "./agenda.ts";

interface AgendaViewProps {
  today: string;
  /** days loaded from today */
  days: number;
  /** the most it may load */
  maxDays: number;
  zone: string;
  /** hidden calendars left out; null while loading */
  events: CalEvent[] | null;
  calendars: ReadonlyMap<string, Calendar>;
  onOpen: (event: CalEvent) => void;
  onMore: () => void;
}

/** What is coming, day by day, from today. More days load on scrolling to the end. */
export function AgendaView({ today, days, maxDays, zone, events, calendars, onOpen, onMore }: AgendaViewProps) {
  const end = addDays(today, days);
  const list = events ? agendaDays(events, today, end, zone) : [];
  const sentinel = useRef<HTMLDivElement>(null);
  const loading = events === null;

  useEffect(() => {
    const el = sentinel.current;
    if (!el || loading || days >= maxDays) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onMore();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, days, maxDays, onMore]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <header className="border-b border-stone-200 px-4 py-2">
        <h1 className="text-lg font-semibold text-stone-800">Agenda</h1>
      </header>
      <div className="mx-auto max-w-3xl px-4 py-4">
        {list.length === 0 && !loading && (
          <p className="py-8 text-center text-sm text-stone-400">
            Nothing from {today} to {addDays(end, -1)}.
          </p>
        )}
        {list.map(([date, items]) => (
          <section key={date} className="mb-4">
            <h2
              className={`sticky top-0 z-10 bg-stone-50/95 py-1 text-sm font-semibold tabular-nums ${
                date === today ? "text-indigo-700" : "text-stone-600"
              }`}
            >
              {dayHeading(date)}
              {date === today && <span className="ml-2 text-xs font-medium text-indigo-500">Today</span>}
            </h2>
            <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
              {items.map((item) => (
                <li key={`${item.event.id}-${item.day}`}>
                  <button
                    type="button"
                    onClick={() => onOpen(item.event)}
                    className="flex w-full items-baseline gap-3 px-3 py-2 text-left text-sm hover:bg-stone-50"
                  >
                    <span className="w-28 shrink-0 text-stone-500 tabular-nums">{timeRange(item, date, zone)}</span>
                    <span
                      className={`h-2.5 w-2.5 shrink-0 self-center rounded-full ${
                        CAL_COLORS[calendars.get(item.event.calendarId)?.color ?? "stone"].dot
                      }`}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="text-stone-800">{item.event.title}</span>
                      {item.days > 1 && (
                        <span className="ml-2 text-xs text-stone-400">
                          day {item.day}/{item.days}
                        </span>
                      )}
                      {item.event.location && (
                        <span className="block truncate text-xs text-stone-400">{item.event.location}</span>
                      )}
                    </span>
                    <span className="hidden shrink-0 text-xs text-stone-400 sm:inline">
                      {calendars.get(item.event.calendarId)?.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <div ref={sentinel} className="py-4 text-center">
          {loading ? (
            <span className="text-sm text-stone-400">Loading…</span>
          ) : days < maxDays ? (
            <button type="button" className={secondaryButton} onClick={onMore}>
              Show the days after {addDays(end, -1)}
            </button>
          ) : (
            <span className="text-xs text-stone-400">Up to {addDays(end, -1)}. Use the month view to go further.</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** "14:00–15:30", "All day", "from 22:00", "until 02:00", for one day of an event. */
function timeRange({ event, day, days }: AgendaItem, date: string, zone: string): string {
  if (event.allDay) return "All day";
  const s = toWall(event.start, zone);
  const e = toWall(event.end, zone);
  const starts = s.date === date;
  const ends = e.date === date;
  if (event.start === event.end) return s.time;
  if (starts && (ends || days === 1)) return `${s.time}–${e.time}`;
  if (starts) return `from ${s.time}`;
  if (ends && day === days) return `until ${e.time}`;
  return "All day";
}
