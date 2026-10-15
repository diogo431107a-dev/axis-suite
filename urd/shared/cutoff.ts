// When a session stops by itself, and which day its time counts for. Both are settled the moment
// Play is pressed, from the wall clock where it was pressed:
//
// - A session runs until the next midnight, and stops there by itself.
// - One started at 22:00 or later may run past midnight, and stops at 05:00 the next morning.
// - Its time counts for the day it started, even the part after midnight.

import { addDays, pad } from "./dates.ts";
import { toInstantMs, toWall } from "./zones.ts";

/** From this hour on, a session may run past midnight… */
export const LATE_START_HOUR = 22;
/** …until this hour the next morning. */
export const LATE_STOP_HOUR = 5;

export interface SessionBounds {
  /** YYYY-MM-DD: the local date the session started, which its time counts for */
  day: string;
  /** when it stops by itself (ms since 1970, whole seconds) */
  cutoffMs: number;
}

/** The day and the automatic stop of a session started at `startMs` in `zone`. */
export function sessionBounds(startMs: number, zone: string): SessionBounds {
  const wall = toWall(startMs, zone);
  const next = addDays(wall.date, 1);
  const late = Number(wall.time.slice(0, 2)) >= LATE_START_HOUR;
  // On a day whose clocks skip midnight (a few zones start summer time at 00:00) this is 01:00.
  const cutoffMs = toInstantMs(`${next}T${late ? pad(LATE_STOP_HOUR) : "00"}:00`, zone);
  return { day: wall.date, cutoffMs };
}
