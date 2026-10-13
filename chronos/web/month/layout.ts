// How a week of the month view is laid out. Events that span days (all-day ones, and timed ones
// that cross midnight) are bars across the days they cover, stacked in lanes; the rest are lines
// under their day, by time.
import type { CalEvent } from "../../shared/protocol.ts";
import { firstDay, lastDay } from "../format.ts";

export interface Bar {
  event: CalEvent;
  /** the first column it covers in this week (Monday 0) and how many */
  col: number;
  span: number;
  lane: number;
  /** it started before this week, or goes on after it */
  before: boolean;
  after: boolean;
}

export interface WeekLayout {
  bars: Bar[];
  /** lanes in use */
  lanes: number;
  /** one list per day: its timed events that stay within the day, by start */
  lines: CalEvent[][];
}

/** Lays out the events touching a week (7 dates, Monday first), with days as they are in `zone`. */
export function layoutWeek(week: string[], events: CalEvent[], zone: string): WeekLayout {
  const first = week[0]!;
  const last = week[6]!;
  const lines: CalEvent[][] = week.map(() => []);
  const spans: { event: CalEvent; from: string; to: string }[] = [];
  for (const event of events) {
    const from = firstDay(event, zone);
    const to = lastDay(event, zone);
    if (to < first || from > last) continue;
    if (event.allDay || from !== to) spans.push({ event, from, to });
    else lines[week.indexOf(from)]!.push(event);
  }
  for (const day of lines) day.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  // Earliest first, then the longest, so long bars stay on top.
  spans.sort((a, b) => (a.from !== b.from ? (a.from < b.from ? -1 : 1) : a.to !== b.to ? (a.to > b.to ? -1 : 1) : 0));
  const taken: boolean[][] = [];
  const bars: Bar[] = [];
  for (const { event, from, to } of spans) {
    const col = from < first ? 0 : week.indexOf(from);
    const end = to > last ? 6 : week.indexOf(to);
    let lane = 0;
    while (taken[lane]?.slice(col, end + 1).some(Boolean)) lane++;
    taken[lane] ??= Array<boolean>(7).fill(false);
    for (let c = col; c <= end; c++) taken[lane]![c] = true;
    bars.push({ event, col, span: end - col + 1, lane, before: from < first, after: to > last });
  }
  return { bars, lanes: taken.length, lines };
}
