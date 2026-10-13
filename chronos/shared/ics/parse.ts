// Reading .ics files (RFC 5545) into the events Chronos imports. Only VEVENTs are read; to-dos,
// journal entries and alarms are counted and left out.
//
// Times: a date (VALUE=DATE) makes an all-day event. A time with Z is UTC. A time with TZID is in
// that zone (an IANA name, a Windows name, or else the fixed offset of the file's VTIMEZONE).
// A time with neither ("floating") is read in the file's X-WR-TIMEZONE, or else the home zone.

import { addDays, addYears, daysBetween } from "../dates.ts";
import { EXPAND, LIMITS, type ImportEvent } from "../protocol.ts";
import { fixedZone, instantOf, msOf, toInstantMs, toWall, zoneFromTzid, zoneName } from "../zones.ts";
import { expandRule } from "./expand.ts";
import { logicalLines, parseLine, unescapeText, type Prop } from "./lines.ts";

export interface IcsReport {
  /** VEVENTs in the file */
  events: number;
  /** of those, repeating ones (RRULE or RDATE) */
  repeating: number;
  /** events they became */
  occurrences: number;
  /** repeating events with more occurrences in the window than the limit */
  truncated: number;
  /** events whose zone wasn't recognised (read in a fixed offset, or the home zone) */
  unknownZones: number;
  /** cancelled events and occurrences, left out */
  cancelled: number;
  /** VEVENTs without a start that can be read */
  unreadable: number;
  /** to-dos, journal entries and other components that aren't events */
  otherComponents: number;
}

export interface IcsRead {
  /** X-WR-CALNAME, or null */
  calendarName: string | null;
  events: ImportEvent[];
  report: IcsReport;
}

export interface IcsOptions {
  /** where floating times are when the file doesn't say */
  homeZone: string;
  /** today's date: repeating events are unrolled around it */
  today: string;
}

type When = { allDay: true; date: string } | { allDay: false; wall: string; zone: string; known: boolean };

interface Component {
  name: string;
  props: Prop[];
  children: Component[];
}

/** The components of a file, nested. */
function components(text: string): Component[] {
  const root: Component = { name: "", props: [], children: [] };
  const stack = [root];
  for (const line of logicalLines(text)) {
    const prop = parseLine(line);
    if (!prop) continue;
    const top = stack[stack.length - 1]!;
    if (prop.name === "BEGIN") {
      const c: Component = { name: prop.value.trim().toUpperCase(), props: [], children: [] };
      top.children.push(c);
      stack.push(c);
    } else if (prop.name === "END") {
      if (stack.length > 1) stack.pop();
    } else {
      top.props.push(prop);
    }
  }
  return root.children;
}

const first = (c: Component, name: string) => c.props.find((p) => p.name === name);
const all = (c: Component, name: string) => c.props.filter((p) => p.name === name);
const param = (p: Prop, name: string) => p.params.get(name)?.[0];

const DATE_VALUE = /^(\d{4})-?(\d{2})-?(\d{2})(?:T(\d{2}):?(\d{2})(?::?(\d{2}))?(Z)?)?$/i;

/** A short hash, for events that come without a UID. */
function hash(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619);
    h2 = Math.imul(h2 ^ s.charCodeAt(i), 2654435761);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

const cut = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);

export function parseIcs(text: string, options: IcsOptions): IcsRead {
  const report: IcsReport = {
    events: 0,
    repeating: 0,
    occurrences: 0,
    truncated: 0,
    unknownZones: 0,
    cancelled: 0,
    unreadable: 0,
    otherComponents: 0,
  };
  const roots = components(text);
  const calendars = roots.filter((c) => c.name === "VCALENDAR");
  if (calendars.length === 0) throw new Error("This is not an iCalendar (.ics) file: it has no BEGIN:VCALENDAR.");

  const props = calendars.flatMap((c) => c.props);
  const calName = props.find((p) => p.name === "X-WR-CALNAME");
  const calendarName = calName ? unescapeText(calName.value).trim() || null : null;
  const fileZoneProp = props.find((p) => p.name === "X-WR-TIMEZONE");
  const floatingZone = (fileZoneProp && zoneFromTzid(fileZoneProp.value)) || options.homeZone;

  const children = calendars.flatMap((c) => c.children);
  // The file's own zone definitions: their standard offset, for TZIDs that name no known zone.
  const fixedOffsets = new Map<string, string>();
  for (const tz of children.filter((c) => c.name === "VTIMEZONE")) {
    const id = first(tz, "TZID")?.value.trim();
    const standard = tz.children.find((c) => c.name === "STANDARD") ?? tz.children[0];
    const offset = standard && first(standard, "TZOFFSETTO")?.value.trim();
    const m = offset && /^([+-])(\d{2})(\d{2})/.exec(offset);
    if (id && m) fixedOffsets.set(id, fixedZone((m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]))));
  }
  const zones = new Map<string, { zone: string; known: boolean }>();
  function zoneOf(tzid: string): { zone: string; known: boolean } {
    let z = zones.get(tzid);
    if (!z) {
      const named = zoneFromTzid(tzid);
      const fixed = fixedOffsets.get(tzid);
      z = named ? { zone: named, known: true } : { zone: fixed ?? options.homeZone, known: false };
      zones.set(tzid, z);
    }
    return z;
  }

  /** A DTSTART-like value (one of a list, for EXDATE and RDATE), or null if it can't be read. */
  function when(p: Prop, value = p.value): When | null {
    const m = DATE_VALUE.exec(value.trim());
    if (!m) return null;
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    if (!m[4] || param(p, "VALUE")?.toUpperCase() === "DATE") return { allDay: true, date };
    const wall = `${date}T${m[4]}:${m[5]}:${m[6] ?? "00"}`;
    if (m[7]) return { allDay: false, wall, zone: "UTC", known: true };
    const tzid = param(p, "TZID");
    if (tzid) return { allDay: false, wall, ...zoneOf(tzid) };
    return { allDay: false, wall, zone: floatingZone, known: true };
  }

  const ms = (w: When & { allDay: false }) => toInstantMs(w.wall, w.zone);
  const window = { from: addYears(options.today, -EXPAND.yearsBack), to: addYears(options.today, EXPAND.yearsAhead) };

  const vevents = children.filter((c) => c.name === "VEVENT");
  report.otherComponents = children.filter((c) => !["VEVENT", "VTIMEZONE"].includes(c.name)).length;
  report.events = vevents.length;

  /** The key of an occurrence's original start: its date, or its instant in UTC. */
  const keyOf = (w: When) => (w.allDay ? w.date : instantOf(ms(w)));

  // Changed occurrences of repeating events (RECURRENCE-ID), by UID: they replace the occurrence
  // the rule would have made.
  const overridden = new Map<string, Set<string>>();
  for (const ev of vevents) {
    const rid = first(ev, "RECURRENCE-ID");
    const uid = first(ev, "UID")?.value.trim();
    const w = rid && when(rid);
    if (uid && w) overridden.set(uid, (overridden.get(uid) ?? new Set()).add(keyOf(w)));
  }

  const events: ImportEvent[] = [];
  const seen = new Set<string>();

  for (const ev of vevents) {
    const startProp = first(ev, "DTSTART");
    const start = startProp && when(startProp);
    if (!start) {
      report.unreadable++;
      continue;
    }
    const summary = unescapeText(first(ev, "SUMMARY")?.value ?? "").trim();
    const status = first(ev, "STATUS")?.value.trim().toUpperCase();
    if (!start.allDay && !start.known) report.unknownZones++;

    // How long it lasts: days for an all-day event, milliseconds for a timed one.
    const endProp = first(ev, "DTEND");
    const end = endProp && when(endProp);
    const duration = parseDuration(first(ev, "DURATION")?.value);
    let days = 1;
    let length = 0;
    if (start.allDay) {
      if (end) days = daysBetween(start.date, end.allDay ? end.date : end.wall.slice(0, 10));
      else if (duration) days = Math.floor(duration / 86_400_000);
      if (days < 1) days = 1;
    } else {
      if (end) length = (end.allDay ? toInstantMs(`${end.date}T00:00`, start.zone) : ms(end)) - ms(start);
      else if (duration) length = duration;
      if (length < 0) length = 0;
    }

    const chronosUid = first(ev, "X-CHRONOS-UID")?.value.trim();
    let uid = chronosUid || first(ev, "UID")?.value.trim() || "";
    if (!uid) uid = `${hash(`${startProp.value}|${summary}`)}@import.chronos`;
    const ridProp = first(ev, "RECURRENCE-ID");
    const rid = ridProp && when(ridProp);
    const keptZone = first(ev, "X-CHRONOS-SOURCE-ZONE")?.value.trim();
    const sourceZone = start.allDay ? null : (keptZone && zoneName(keptZone)) || zoneName(start.zone);
    const base = {
      title: cut(summary || "Untitled", LIMITS.titleChars),
      allDay: start.allDay,
      sourceZone,
      location: cut(unescapeText(first(ev, "LOCATION")?.value ?? "").trim(), LIMITS.locationChars),
      description: cut(unescapeText(first(ev, "DESCRIPTION")?.value ?? "").trim(), LIMITS.descriptionChars),
      url: webUrl(first(ev, "URL")?.value.trim() ?? ""),
    };
    const add = (recurrenceId: string, s: When) => {
      // A file that gives two events the same UID (it happens) keeps both.
      let key = uid;
      for (let n = 2; seen.has(`${key}\n${recurrenceId}`); n++) key = `${uid}#${n}`;
      seen.add(`${key}\n${recurrenceId}`);
      const event: ImportEvent = s.allDay
        ? { uid: key, recurrenceId, ...base, start: s.date, end: addDays(s.date, days) }
        : { uid: key, recurrenceId, ...base, start: instantOf(ms(s)), end: instantOf(ms(s) + length) };
      events.push(event);
    };

    const chronosRid = first(ev, "X-CHRONOS-RECURRENCE-ID")?.value.trim();
    if (chronosUid) {
      // Written by Chronos: one occurrence already, never a rule.
      if (status !== "CANCELLED") add(chronosRid ?? "", start);
      else report.cancelled++;
      continue;
    }
    if (rid) {
      // A changed occurrence of a repeating event.
      if (status === "CANCELLED") report.cancelled++;
      else add(keyOf(rid), start);
      continue;
    }
    if (status === "CANCELLED") {
      report.cancelled++;
      continue;
    }

    const rrule = first(ev, "RRULE");
    const rdates = all(ev, "RDATE");
    if (!rrule && rdates.length === 0) {
      add("", start);
      continue;
    }

    // A repeating event: every occurrence in the window becomes an event of its own.
    report.repeating++;
    const startWall = start.allDay ? `${start.date}T00:00:00` : start.wall;
    /** A time from the file as a wall time in this event's zone (midnight for an all-day event). */
    const inZone = (w: When): string => {
      if (w.allDay) return `${w.date}T00:00:00`;
      if (start.allDay) return `${w.wall.slice(0, 10)}T00:00:00`;
      const x = toWall(ms(w), start.zone);
      return `${x.date}T${x.time}:${pad2(x.second)}`;
    };
    const walls = new Set<string>();
    if (rrule) {
      const untilMatch = /(?:^|;)UNTIL=([^;]+)/i.exec(rrule.value);
      const untilWhen = untilMatch ? when({ name: "UNTIL", params: new Map(), value: "" }, untilMatch[1]!) : null;
      // A date UNTIL takes in the whole day.
      let until: string | null = null;
      if (untilWhen?.allDay) until = `${untilWhen.date}T23:59:59`;
      else if (untilWhen) until = start.allDay ? `${untilWhen.wall.slice(0, 10)}T23:59:59` : inZone(untilWhen);
      try {
        const expansion = expandRule(rrule.value, startWall, until, window, EXPAND.perEvent);
        if (expansion.truncated) report.truncated++;
        for (const w of expansion.walls) walls.add(w);
      } catch {
        // A rule rrule can't read: the first occurrence is all that is known.
        walls.add(startWall);
      }
    } else if (startWall.slice(0, 10) >= window.from && startWall.slice(0, 10) <= window.to) {
      walls.add(startWall);
    }
    for (const p of rdates) {
      for (const v of p.value.split(",")) {
        const w = when(p, v.split("/")[0]!);
        if (w) walls.add(inZone(w));
      }
    }
    const excluded = new Set<string>();
    for (const p of all(ev, "EXDATE")) {
      for (const v of p.value.split(",")) {
        const w = when(p, v);
        if (w) excluded.add(inZone(w));
      }
    }
    const replaced = overridden.get(uid) ?? new Set<string>();
    let made = 0;
    for (const wall of [...walls].sort()) {
      if (excluded.has(wall) || (!start.allDay && excluded.has(`${wall.slice(0, 10)}T00:00:00`))) continue;
      const occurrence: When = start.allDay
        ? { allDay: true, date: wall.slice(0, 10) }
        : { allDay: false, wall, zone: start.zone, known: start.known };
      const key = keyOf(occurrence);
      if (replaced.has(key)) continue;
      add(key, occurrence);
      made++;
    }
    report.occurrences += made;
  }

  return { calendarName, events, report };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** An ISO 8601 duration as iCalendar writes it (P1D, PT1H30M, P2W), in milliseconds; null if none. */
export function parseDuration(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value.trim());
  if (!m) return null;
  const [, sign, w, d, h, min, s] = m;
  const total =
    ((Number(w ?? 0) * 7 + Number(d ?? 0)) * 86_400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0)) *
    1000;
  return sign === "-" ? -total : total;
}

/** A link kept only when it is http(s). */
function webUrl(value: string): string {
  if (value.length > LIMITS.urlChars) return "";
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:" ? value : "";
  } catch {
    return "";
  }
}

/** The dates the events of a read file span, in a zone: for the import dialog. */
export function spanOf(events: ImportEvent[], zone: string): { first: string; last: string } | null {
  if (events.length === 0) return null;
  let lo = "9999-12-31";
  let hi = "0000-01-01";
  for (const e of events) {
    const d = e.allDay ? e.start : toWall(msOf(e.start), zone).date;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return { first: lo, last: hi };
}
