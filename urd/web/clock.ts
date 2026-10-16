// The running clock. Times are never counted up: each tick works them out from when the session
// started and the time now, so a laptop that slept or a tab the browser slowed down is right again
// on its next tick. One timer serves every part of the page that shows a live number.
import { useSyncExternalStore } from "react";
import { addDays, monthOf, weekStart } from "../shared/dates.ts";
import { daySpans } from "../shared/days.ts";
import type { Periods, Session, Tally } from "../shared/protocol.ts";

/**
 * How far the server's clock is ahead of this computer's, in ms, from a time the server just sent.
 * A gap of up to 2 seconds is the request's own delay (and whole seconds): it is ignored.
 */
export function clockSkew(serverNow: string, localNow = Date.now()): number {
  const gap = Date.parse(serverNow) - localNow;
  return Math.abs(gap) > 2000 ? gap : 0;
}

/** A session's whole seconds at `nowMs`: up to its end, or to now while it runs. */
export function elapsed(session: Session, nowMs: number): number {
  const end = session.endedAt ? Date.parse(session.endedAt) : nowMs;
  return Math.max(0, Math.floor((end - Date.parse(session.startedAt)) / 1000));
}

/** Where a session ends at `nowMs` (ms): its end, or now, in whole seconds, while it runs. */
export const endOf = (session: Session, nowMs: number) =>
  session.endedAt ? Date.parse(session.endedAt) : Date.parse(session.startedAt) + elapsed(session, nowMs) * 1000;

/**
 * Periods around `day` as they are at `nowMs`: as the server counted them, plus what the running
 * session has run since, which may make it the longest. `running` is null when it doesn't count in
 * these periods (another project's).
 */
export function livePeriods(periods: Periods, running: Session | null, nowMs: number, day: string): Periods {
  const extra = running ? elapsed(running, nowMs) - running.seconds : 0;
  if (!running || extra <= 0) return periods;
  const spans = daySpans(Date.parse(running.startedAt), endOf(running, nowMs), running.zone);
  const monday = weekStart(day);
  const sunday = addDays(monday, 6);
  // The running session's part in a period.
  const partIn = (inside: (d: string) => boolean) =>
    spans.filter((s) => inside(s.day)).reduce((sum, s) => sum + s.seconds, 0);
  const add = (t: Tally, part: number): Tally => ({
    ...t,
    seconds: t.seconds + extra,
    longest: Math.max(t.longest, part),
  });
  return {
    today: add(
      periods.today,
      partIn((d) => d === day),
    ),
    week: add(
      periods.week,
      partIn((d) => d >= monday && d <= sunday),
    ),
    month: add(
      periods.month,
      partIn((d) => monthOf(d) === monthOf(day)),
    ),
    overall: add(periods.overall, elapsed(running, nowMs)),
  };
}

const listeners = new Set<() => void>();
let current = Date.now();
let timer: ReturnType<typeof setTimeout> | undefined;

function schedule(): void {
  // Just after the next whole second of this computer's clock.
  timer = setTimeout(
    () => {
      current = Date.now();
      for (const listener of listeners) listener();
      schedule();
    },
    1005 - (Date.now() % 1000),
  );
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    current = Date.now();
    schedule();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) clearTimeout(timer);
  };
}

const still = () => () => {};

/** This computer's time (ms), updated every whole second while `ticking`. */
export function useSecond(ticking = true): number {
  return useSyncExternalStore(ticking ? subscribe : still, () => current);
}
