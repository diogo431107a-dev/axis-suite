// Time zones, with nothing but Intl (Node and browsers ship the IANA database with it).
//
// Chronos keeps a timed event as two instants in UTC and shows them in one time zone, the user's
// home zone. Here: turning an instant into the date and time on a wall clock somewhere, and back.
// A zone is an IANA name ("America/Sao_Paulo") or a fixed offset written "UTC+03:00" (for files
// whose zone has no IANA name).

import { addDays, dateOfUtc, pad } from "./dates.ts";

const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;
const FIXED = /^UTC([+-])(\d{2}):(\d{2})$/;
const WALL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Whether a value is an instant as Chronos writes them: YYYY-MM-DDTHH:MM:SSZ. */
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
function canonical(name: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: name }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** Whether a name is a time zone Chronos can use: an IANA name or UTC±HH:MM. */
export function isZone(name: unknown): name is string {
  if (typeof name !== "string" || name === "") return false;
  if (FIXED.test(name)) return fixedOffset(name) !== null;
  return canonical(name) !== null;
}

/** The zone's usual name: IANA names as Intl spells them; fixed offsets as they are. Null if it isn't one. */
export function zoneName(name: string): string | null {
  if (FIXED.test(name)) return fixedOffset(name) === null ? null : name;
  return canonical(name);
}

/** Minutes east of UTC of a fixed zone (UTC+03:00 → 180), or null if it isn't one. */
function fixedOffset(zone: string): number | null {
  const m = FIXED.exec(zone);
  if (!m) return null;
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  if (Number(m[3]) >= 60 || minutes > 14 * 60) return null;
  return m[1] === "-" ? -minutes : minutes;
}

/** A fixed zone from minutes east of UTC: 180 → UTC+03:00. */
export function fixedZone(minutes: number): string {
  const abs = Math.abs(minutes);
  return `UTC${minutes < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Wall-clock parts of an instant in a zone. */
function wallParts(ms: number, zone: string) {
  const fixed = fixedOffset(zone);
  if (fixed !== null) {
    const d = new Date(ms + fixed * 60_000);
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
    };
  }
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
  const fixed = fixedOffset(zone);
  if (fixed !== null) return fixed;
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
 * A time the clocks skip (spring forward) moves on by the length of the jump: 02:30 on a day
 * that jumps from 02:00 to 03:00 is 03:30, as iCalendar says. A time they show twice (fall
 * back) is the first of the two.
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

/** toInstantMs as YYYY-MM-DDTHH:MM:SSZ. */
export const toInstant = (wall: string, zone: string) => instantOf(toInstantMs(wall, zone));

/** The instant a date begins in a zone (usually its midnight). */
export const dayStart = (date: string, zone: string) => toInstant(`${date}T00:00`, zone);

/** Today's date in a zone. */
export const todayIn = (zone: string, now = Date.now()) => toWall(now, zone).date;

/** The date of an instant in UTC, for when no zone is known. */
export const utcDate = (instant: string) => dateOfUtc(new Date(msOf(instant)));

/**
 * The dates a timed event touches in a zone: from the day it starts to the day it ends (an event
 * ending at midnight doesn't touch the next day).
 */
export function daysTouched(start: string, end: string, zone: string): { first: string; last: string } {
  const first = toWall(start, zone).date;
  const endWall = toWall(end, zone);
  let last = endWall.date;
  if (end > start && endWall.time === "00:00" && endWall.second === 0) last = addDays(last, -1);
  return { first, last: last < first ? first : last };
}

// Outlook and Exchange name zones their own way. The common ones, from CLDR's windowsZones.xml.
export const WINDOWS_ZONES: Record<string, string> = {
  "Dateline Standard Time": "Etc/GMT+12",
  "UTC-11": "Etc/GMT+11",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Alaskan Standard Time": "America/Anchorage",
  "Pacific Standard Time": "America/Los_Angeles",
  "Pacific Standard Time (Mexico)": "America/Tijuana",
  "US Mountain Standard Time": "America/Phoenix",
  "Mountain Standard Time": "America/Denver",
  "Central America Standard Time": "America/Guatemala",
  "Central Standard Time": "America/Chicago",
  "Central Standard Time (Mexico)": "America/Mexico_City",
  "Canada Central Standard Time": "America/Regina",
  "SA Pacific Standard Time": "America/Bogota",
  "Eastern Standard Time": "America/New_York",
  "Eastern Standard Time (Mexico)": "America/Cancun",
  "Venezuela Standard Time": "America/Caracas",
  "Atlantic Standard Time": "America/Halifax",
  "SA Western Standard Time": "America/La_Paz",
  "Pacific SA Standard Time": "America/Santiago",
  "Newfoundland Standard Time": "America/St_Johns",
  "E. South America Standard Time": "America/Sao_Paulo",
  "Argentina Standard Time": "America/Argentina/Buenos_Aires",
  "SA Eastern Standard Time": "America/Cayenne",
  "Montevideo Standard Time": "America/Montevideo",
  "Bahia Standard Time": "America/Bahia",
  "Tocantins Standard Time": "America/Araguaina",
  "Central Brazilian Standard Time": "America/Cuiaba",
  "Paraguay Standard Time": "America/Asuncion",
  "UTC-02": "Etc/GMT+2",
  "Azores Standard Time": "Atlantic/Azores",
  "Cape Verde Standard Time": "Atlantic/Cape_Verde",
  UTC: "Etc/UTC",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "Morocco Standard Time": "Africa/Casablanca",
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Budapest",
  "Romance Standard Time": "Europe/Paris",
  "Central European Standard Time": "Europe/Warsaw",
  "W. Central Africa Standard Time": "Africa/Lagos",
  "GTB Standard Time": "Europe/Bucharest",
  "FLE Standard Time": "Europe/Kiev",
  "E. Europe Standard Time": "Europe/Chisinau",
  "Egypt Standard Time": "Africa/Cairo",
  "South Africa Standard Time": "Africa/Johannesburg",
  "Israel Standard Time": "Asia/Jerusalem",
  "Turkey Standard Time": "Europe/Istanbul",
  "Arab Standard Time": "Asia/Riyadh",
  "Russian Standard Time": "Europe/Moscow",
  "E. Africa Standard Time": "Africa/Nairobi",
  "Arabian Standard Time": "Asia/Dubai",
  "Iran Standard Time": "Asia/Tehran",
  "Afghanistan Standard Time": "Asia/Kabul",
  "Pakistan Standard Time": "Asia/Karachi",
  "India Standard Time": "Asia/Kolkata",
  "Nepal Standard Time": "Asia/Kathmandu",
  "Bangladesh Standard Time": "Asia/Dhaka",
  "SE Asia Standard Time": "Asia/Bangkok",
  "China Standard Time": "Asia/Shanghai",
  "Singapore Standard Time": "Asia/Singapore",
  "W. Australia Standard Time": "Australia/Perth",
  "Taipei Standard Time": "Asia/Taipei",
  "Tokyo Standard Time": "Asia/Tokyo",
  "Korea Standard Time": "Asia/Seoul",
  "Cen. Australia Standard Time": "Australia/Adelaide",
  "AUS Central Standard Time": "Australia/Darwin",
  "E. Australia Standard Time": "Australia/Brisbane",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "Tasmania Standard Time": "Australia/Hobart",
  "New Zealand Standard Time": "Pacific/Auckland",
  "Tonga Standard Time": "Pacific/Tongatapu",
};

/**
 * The zone a file's TZID means, or null: an IANA name (also inside a longer one, like
 * "/mozilla.org/20050126_1/America/Sao_Paulo"), or a Windows name.
 */
export function zoneFromTzid(tzid: string): string | null {
  const name = tzid.trim().replace(/^"|"$/g, "");
  if (!name) return null;
  const windows = WINDOWS_ZONES[name];
  if (windows) return canonical(windows);
  if (FIXED.test(name)) return zoneName(name);
  const direct = canonical(name);
  if (direct) return direct;
  // A prefix before the IANA name: try the last three, then the last two parts.
  const parts = name.split("/").filter(Boolean);
  for (const n of [3, 2]) {
    if (parts.length > n) {
      const tail = canonical(parts.slice(-n).join("/"));
      if (tail) return tail;
    }
  }
  return null;
}
