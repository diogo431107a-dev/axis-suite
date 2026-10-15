// Time zones, with nothing but Intl (Node and browsers ship the IANA database with it): turning an
// instant into the date and time on a wall clock somewhere, and back. Taken from Chronos's
// shared/zones.ts, keeping what Urd uses. Urd's zones are the ones browsers report, so only IANA
// names ("America/Sao_Paulo"), not Chronos's fixed offsets.

import { pad } from "./dates.ts";

const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;
const WALL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Whether a value is an instant as Urd writes them: YYYY-MM-DDTHH:MM:SSZ. */
export function isInstant(value: unknown): value is string {
  if (typeof value !== "string" || !INSTANT.test(value)) return false;
  const ms = Date.parse(value);
  return !Number.isNaN(ms) && instantOf(ms) === value && Number(value.slice(0, 4)) >= 1000;
}

/** Milliseconds since 1970 → YYYY-MM-DDTHH:MM:SSZ (whole seconds). */
export const instantOf = (ms: number) => `${new Date(ms).toISOString().slice(0, 19)}Z`;

export const msOf = (instant: string) => Date.parse(instant);

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    // en-US with h23 gives plain numbers; only the numeric parts are read, never the text.
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, f);
  }
  return f;
}

/** The IANA name a zone is known by ("america/sao_paulo" → "America/Sao_Paulo"), or null if there is none. */
export function zoneName(name: unknown): string | null {
  if (typeof name !== "string" || name === "") return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: name }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** Wall-clock parts of an instant in a zone. */
function wallParts(ms: number, zone: string) {
  const parts: Record<string, number> = {};
  for (const p of formatter(zone).formatToParts(ms)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour! % 24,
    minute: parts.minute!,
    second: parts.second!,
  };
}

const wallMs = (p: ReturnType<typeof wallParts>) => {
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
  d.setUTCFullYear(p.year);
  return d.getTime();
};

/** How many minutes a zone's clocks are ahead of UTC at an instant (Sao Paulo: -180). */
export function zoneOffset(ms: number, zone: string): number {
  const whole = Math.floor(ms / 1000) * 1000;
  return Math.round((wallMs(wallParts(whole, zone)) - whole) / 60_000);
}

/** The wall clock in a zone at an instant: its date, HH:MM, and seconds. */
export function toWall(instant: string | number, zone: string): { date: string; time: string; second: number } {
  const p = wallParts(typeof instant === "number" ? instant : msOf(instant), zone);
  return {
    date: `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
    second: p.second,
  };
}

/**
 * The instant a wall clock in a zone shows a date and time ("2026-11-08T14:00", seconds optional).
 * A time the clocks skip (spring forward) moves on by the length of the jump: 00:00 on a day that
 * jumps from 00:00 to 01:00 is 01:00. A time they show twice (fall back) is the first of the two.
 */
export function toInstantMs(wall: string, zone: string): number {
  const m = WALL.exec(wall);
  if (!m) throw new Error(`Not a date and time: ${wall}`);
  const d = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)),
  );
  d.setUTCFullYear(Number(m[1]));
  const t = d.getTime();
  // The offsets in force around that time: one, or two when the clocks change that day.
  const offsets = [
    ...new Set([zoneOffset(t - 86_400_000, zone), zoneOffset(t, zone), zoneOffset(t + 86_400_000, zone)]),
  ];
  const fits = offsets.map((o) => t - o * 60_000).filter((c) => zoneOffset(c, zone) * 60_000 === t - c);
  if (fits.length > 0) return Math.min(...fits);
  // In the gap: read it with the offset from before the jump, which is the smaller one.
  return t - Math.min(...offsets) * 60_000;
}
