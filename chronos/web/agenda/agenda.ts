// Agenda: the days from a date on that have events, each with what is on it.
import { addDays, daysBetween } from "../../shared/dates.ts";
import type { CalEvent } from "../../shared/protocol.ts";
import { firstDay, lastDay } from "../format.ts";

export interface AgendaItem {
  event: CalEvent;
  /** for an event over several days: which of them this is (1-based), and how many */
  day: number;
  days: number;
}

/** The days in [from, to) with events, in order, each with its events: all-day ones first, then by time. */
export function agendaDays(events: CalEvent[], from: string, to: string, zone: string): [string, AgendaItem[]][] {
  const byDay = new Map<string, AgendaItem[]>();
  for (const event of events) {
    const first = firstDay(event, zone);
    const last = lastDay(event, zone);
    const days = daysBetween(first, last) + 1;
    for (let d = first < from ? from : first; d <= last && d < to; d = addDays(d, 1)) {
      const list = byDay.get(d) ?? [];
      list.push({ event, day: daysBetween(first, d) + 1, days });
      byDay.set(d, list);
    }
  }
  const rank = (i: AgendaItem) => (i.event.allDay ? 0 : i.day > 1 ? 1 : 2);
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([d, items]) => [
      d,
      items.sort(
        (a, b) => rank(a) - rank(b) || (a.event.start < b.event.start ? -1 : a.event.start > b.event.start ? 1 : 0),
      ),
    ]);
}
