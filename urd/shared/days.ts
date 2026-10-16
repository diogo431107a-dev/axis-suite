// Which days a session's time counts for. A session runs from Play to Stop, however long: nothing
// stops it by itself. Its time is split at each midnight on the wall clock where it was started
// (its zone), so every local day gets the part of it that fell in that day.

import { addDays } from "./dates.ts";
import { toInstantMs, toWall } from "./zones.ts";

/** The part of a session that fell in one local day. */
export interface DaySpan {
  /** YYYY-MM-DD */
  day: string;
  seconds: number;
}

/** The local date in `zone` at an instant (ms since 1970). */
export const dayOf = (ms: number, zone: string) => toWall(ms, zone).date;

/**
 * The last day a session from `startMs` to `endMs` has time in: the date of its last second, so one
 * that ends at 00:00:00 sharp doesn't reach into the new day. A session of no length has its start day.
 */
export const lastDayOf = (startMs: number, endMs: number, zone: string) => dayOf(Math.max(startMs, endMs - 1000), zone);

/**
 * A session's time from `startMs` to `endMs` (whole seconds), split at each local midnight in
 * `zone`, oldest day first. A session of no length is one day of 0 seconds: it still counts as a
 * play/stop. On a day whose clocks skip midnight (a few zones start summer time at 00:00), the day
 * ends at 01:00.
 */
export function daySpans(startMs: number, endMs: number, zone: string): DaySpan[] {
  let day = dayOf(startMs, zone);
  if (endMs <= startMs) return [{ day, seconds: 0 }];
  const spans: DaySpan[] = [];
  for (let from = startMs; from < endMs;) {
    const next = addDays(day, 1);
    const to = Math.min(endMs, toInstantMs(`${next}T00:00`, zone));
    spans.push({ day, seconds: Math.round((to - from) / 1000) });
    from = to;
    day = next;
  }
  return spans;
}
