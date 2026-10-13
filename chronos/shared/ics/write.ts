// Writing a calendar as an .ics file. Times are written in UTC (…Z), which every app reads and
// which needs no VTIMEZONE; all-day events as dates.
//
// Occurrences of a repeating event from an imported file are separate events here, so each gets a
// UID of its own (other apps would merge events sharing one). X-CHRONOS-UID and
// X-CHRONOS-RECURRENCE-ID keep the originals, so importing the file into Chronos again matches the
// same events. X-CHRONOS-SOURCE-ZONE keeps the zone the event came with.

import type { ImportEvent } from "../protocol.ts";
import { escapeText, fold } from "./lines.ts";

const icsDate = (date: string) => date.replaceAll("-", "");
const icsInstant = (instant: string) => instant.replace(/[-:]/g, "");

export function writeIcs(calendarName: string, events: ImportEvent[], now = new Date()): string {
  const stamp = icsInstant(`${now.toISOString().slice(0, 19)}Z`);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Axis Suite//Chronos//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];
  for (const e of events) {
    lines.push("BEGIN:VEVENT");
    if (e.recurrenceId) {
      lines.push(`UID:${e.uid}-${e.recurrenceId.replace(/[-:]/g, "")}`);
      lines.push(`X-CHRONOS-UID:${e.uid}`, `X-CHRONOS-RECURRENCE-ID:${e.recurrenceId}`);
    } else {
      lines.push(`UID:${e.uid}`);
    }
    lines.push(`DTSTAMP:${stamp}`);
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(e.start)}`, `DTEND;VALUE=DATE:${icsDate(e.end)}`);
    } else {
      lines.push(`DTSTART:${icsInstant(e.start)}`, `DTEND:${icsInstant(e.end)}`);
      if (e.sourceZone) lines.push(`X-CHRONOS-SOURCE-ZONE:${e.sourceZone}`);
    }
    lines.push(`SUMMARY:${escapeText(e.title)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
