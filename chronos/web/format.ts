// Every date and time the page shows is written here, the ISO 8601 way and nothing else:
// YYYY-MM-DD, HH:MM on a 24-hour clock, weeks as 2026-W42. Never toLocaleString: it follows the
// browser's language.
import { addDays, weekLabel, weekdayName } from "../shared/dates.ts";
import type { CalEvent } from "../shared/protocol.ts";
import { daysTouched, fixedZone, msOf, toWall, zoneOffset } from "../shared/zones.ts";

/** "2026-10-13 Tue · W42" */
export const dayHeading = (date: string) => `${date} ${weekdayName(date)} · ${weekLabel(date).slice(5)}`;

/** HH:MM of an instant in a zone. */
export const timeOf = (instant: string, zone: string) => toWall(instant, zone).time;

/** An event's last day: all-day events end the day before their (exclusive) end. */
export function lastDay(e: Pick<CalEvent, "allDay" | "start" | "end">, zone: string): string {
  return e.allDay ? addDays(e.end, -1) : daysTouched(e.start, e.end, zone).last;
}

/** An event's first day in a zone. */
export const firstDay = (e: Pick<CalEvent, "allDay" | "start">, zone: string) =>
  e.allDay ? e.start : toWall(e.start, zone).date;

/** When an event is: "2026-11-08 14:00–16:00", "2026-11-08, all day", "2026-11-08 – 2026-11-10". */
export function whenText(e: Pick<CalEvent, "allDay" | "start" | "end">, zone: string): string {
  if (e.allDay) {
    const last = addDays(e.end, -1);
    return last === e.start ? `${e.start}, all day` : `${e.start} – ${last}`;
  }
  const s = toWall(e.start, zone);
  if (e.end === e.start) return `${s.date} ${s.time}`;
  const end = toWall(e.end, zone);
  if (end.date === s.date) return `${s.date} ${s.time}–${end.time}`;
  return `${s.date} ${s.time} – ${end.date} ${end.time}`;
}

/** The zone's offset now, "UTC-03:00". */
export const offsetText = (zone: string, now = Date.now()) => fixedZone(zoneOffset(now, zone));

/** "In Europe/London: 2026-11-08 17:00–19:00", for an event whose file gave another zone; null otherwise. */
export function sourceText(e: CalEvent, homeZone: string): string | null {
  if (e.allDay || !e.sourceZone || e.sourceZone === homeZone) return null;
  if (zoneOffset(msOf(e.start), e.sourceZone) === zoneOffset(msOf(e.start), homeZone)) return null;
  return `In ${e.sourceZone}: ${whenText(e, e.sourceZone)}`;
}

/** An ISO instant (createdAt, importedAt…) as YYYY-MM-DD HH:MM in a zone. */
export function stamp(iso: string, zone: string): string {
  const w = toWall(Date.parse(iso), zone);
  return `${w.date} ${w.time}`;
}

export const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
