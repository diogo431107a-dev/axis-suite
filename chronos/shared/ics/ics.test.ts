import { describe, expect, it } from "vitest";
import { parseDuration, parseIcs, spanOf } from "./parse.ts";
import { writeIcs } from "./write.ts";

const opts = { homeZone: "America/Sao_Paulo", today: "2026-10-13" };
const ics = (...lines: string[]) => lines.join("\r\n");

describe("parseIcs", () => {
  it("reads a Google Calendar export (TZID, folded and escaped text)", () => {
    const read = parseIcs(
      ics(
        "BEGIN:VCALENDAR",
        "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
        "VERSION:2.0",
        "X-WR-CALNAME:Família",
        "X-WR-TIMEZONE:America/Sao_Paulo",
        "BEGIN:VTIMEZONE",
        "TZID:America/Sao_Paulo",
        "BEGIN:STANDARD",
        "TZOFFSETFROM:-0300",
        "TZOFFSETTO:-0300",
        "TZNAME:-03",
        "DTSTART:19700101T000000",
        "END:STANDARD",
        "END:VTIMEZONE",
        "BEGIN:VEVENT",
        "DTSTART;TZID=America/Sao_Paulo:20261108T140000",
        "DTEND;TZID=America/Sao_Paulo:20261108T160000",
        "UID:abc123@google.com",
        "SUMMARY:Almoço\\, família",
        "LOCATION:Rua A\\; 10",
        "DESCRIPTION:Line one\\nLine two that is long enough to be folded by the writer of t",
        " he file",
        "END:VEVENT",
        "END:VCALENDAR",
      ),
      opts,
    );
    expect(read.calendarName).toBe("Família");
    expect(read.events).toEqual([
      {
        uid: "abc123@google.com",
        recurrenceId: "",
        title: "Almoço, família",
        allDay: false,
        start: "2026-11-08T17:00:00Z",
        end: "2026-11-08T19:00:00Z",
        sourceZone: "America/Sao_Paulo",
        location: "Rua A; 10",
        description: "Line one\nLine two that is long enough to be folded by the writer of the file",
        url: "",
      },
    ]);
    expect(read.report.unknownZones).toBe(0);
  });

  it("reads Outlook's Windows zone names, and falls back to a VTIMEZONE's offset", () => {
    const read = parseIcs(
      ics(
        "BEGIN:VCALENDAR",
        "BEGIN:VTIMEZONE",
        "TZID:Custom Zone",
        "BEGIN:STANDARD",
        "DTSTART:16010101T000000",
        "TZOFFSETFROM:+0530",
        "TZOFFSETTO:+0530",
        "END:STANDARD",
        "END:VTIMEZONE",
        "BEGIN:VEVENT",
        'DTSTART;TZID="E. South America Standard Time":20261110T090000',
        'DTEND;TZID="E. South America Standard Time":20261110T093000',
        "UID:o1",
        "SUMMARY:Standup",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "DTSTART;TZID=Custom Zone:20261110T090000",
        "DURATION:PT1H",
        "UID:o2",
        "SUMMARY:Call",
        "END:VEVENT",
        "END:VCALENDAR",
      ),
      opts,
    );
    expect(read.events.map((e) => [e.start, e.end, e.sourceZone])).toEqual([
      ["2026-11-10T12:00:00Z", "2026-11-10T12:30:00Z", "America/Sao_Paulo"],
      ["2026-11-10T03:30:00Z", "2026-11-10T04:30:00Z", "UTC+05:30"],
    ]);
    expect(read.report.unknownZones).toBe(1);
  });

  it("reads an F1 calendar in UTC, leaving alarms out", () => {
    const read = parseIcs(
      ics(
        "BEGIN:VCALENDAR",
        "X-WR-CALNAME:Formula 1",
        "BEGIN:VEVENT",
        "UID:f1-2026-bra-race",
        "DTSTART:20261108T170000Z",
        "DTEND:20261108T190000Z",
        "SUMMARY:FORMULA 1 GRANDE PRÊMIO DE SÃO PAULO - Race",
        "URL:https://www.formula1.com/en/racing/2026/brazil",
        "STATUS:CONFIRMED",
        "BEGIN:VALARM",
        "TRIGGER:-PT30M",
        "ACTION:DISPLAY",
        "DESCRIPTION:Reminder",
        "END:VALARM",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:f1-2026-bra-sprint",
        "DTSTART:20261107T143000Z",
        "SUMMARY:Sprint",
        "STATUS:CANCELLED",
        "END:VEVENT",
        "BEGIN:VTODO",
        "UID:t1",
        "SUMMARY:Buy tickets",
        "END:VTODO",
        "END:VCALENDAR",
      ),
      opts,
    );
    expect(read.events).toHaveLength(1);
    expect(read.events[0]).toMatchObject({
      start: "2026-11-08T17:00:00Z",
      end: "2026-11-08T19:00:00Z",
      sourceZone: "UTC",
      description: "",
      url: "https://www.formula1.com/en/racing/2026/brazil",
    });
    expect(read.report).toMatchObject({ events: 2, cancelled: 1, otherComponents: 1 });
  });

  it("reads all-day moon phases, with or without an end, and makes up stable UIDs", () => {
    const file = ics(
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20261024",
      "SUMMARY:🌕 Full moon",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:moon-2",
      "DTSTART;VALUE=DATE:20261101",
      "DTEND;VALUE=DATE:20261103",
      "SUMMARY:🌗 Last quarter",
      "END:VEVENT",
      "END:VCALENDAR",
    );
    const read = parseIcs(file, opts);
    expect(read.events.map((e) => [e.allDay, e.start, e.end])).toEqual([
      [true, "2026-10-24", "2026-10-25"],
      [true, "2026-11-01", "2026-11-03"],
    ]);
    expect(read.events[0]!.uid).toMatch(/@import\.chronos$/);
    expect(parseIcs(file, opts).events[0]!.uid).toBe(read.events[0]!.uid);
    expect(spanOf(read.events, "UTC")).toEqual({ first: "2026-10-24", last: "2026-11-01" });
  });

  it("unrolls a yearly holiday within the window", () => {
    const read = parseIcs(
      ics(
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:new-year",
        "DTSTART;VALUE=DATE:20000101",
        "DTEND;VALUE=DATE:20000102",
        "RRULE:FREQ=YEARLY",
        "SUMMARY:New Year",
        "END:VEVENT",
        "END:VCALENDAR",
      ),
      opts,
    );
    // The window is 2024-10-13 to 2031-10-13.
    expect(read.events.map((e) => e.start)).toEqual([
      "2025-01-01",
      "2026-01-01",
      "2027-01-01",
      "2028-01-01",
      "2029-01-01",
      "2030-01-01",
      "2031-01-01",
    ]);
    expect(read.events.every((e) => e.uid === "new-year" && e.recurrenceId === e.start && e.end > e.start)).toBe(true);
    expect(read.report).toMatchObject({ repeating: 1, occurrences: 7 });
  });

  it("unrolls a weekly London meeting across the clock change, with an exception and a moved occurrence", () => {
    const read = parseIcs(
      ics(
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:weekly",
        "DTSTART;TZID=Europe/London:20260316T090000",
        "DTEND;TZID=Europe/London:20260316T100000",
        "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=6",
        "EXDATE;TZID=Europe/London:20260323T090000",
        "SUMMARY:Weekly",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:weekly",
        "RECURRENCE-ID;TZID=Europe/London:20260406T090000",
        "DTSTART;TZID=Europe/London:20260406T110000",
        "DTEND;TZID=Europe/London:20260406T120000",
        "SUMMARY:Weekly (moved)",
        "END:VEVENT",
        "END:VCALENDAR",
      ),
      opts,
    );
    const got = read.events.map((e) => [e.recurrenceId, e.start, e.end, e.title]).sort();
    expect(got).toEqual([
      ["2026-03-16T09:00:00Z", "2026-03-16T09:00:00Z", "2026-03-16T10:00:00Z", "Weekly"],
      ["2026-03-30T08:00:00Z", "2026-03-30T08:00:00Z", "2026-03-30T09:00:00Z", "Weekly"],
      ["2026-04-06T08:00:00Z", "2026-04-06T10:00:00Z", "2026-04-06T11:00:00Z", "Weekly (moved)"],
      ["2026-04-13T08:00:00Z", "2026-04-13T08:00:00Z", "2026-04-13T09:00:00Z", "Weekly"],
      ["2026-04-20T08:00:00Z", "2026-04-20T08:00:00Z", "2026-04-20T09:00:00Z", "Weekly"],
    ]);
  });

  it("honours UNTIL in UTC and caps long series", () => {
    const daily = parseIcs(
      ics(
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:d",
        "DTSTART;TZID=America/Sao_Paulo:20261013T080000",
        "RRULE:FREQ=DAILY;UNTIL=20261015T110000Z",
        "SUMMARY:Daily",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:forever",
        "DTSTART:20200101T120000Z",
        "RRULE:FREQ=DAILY",
        "SUMMARY:Forever",
        "END:VEVENT",
        "END:VCALENDAR",
      ),
      opts,
    );
    expect(daily.events.filter((e) => e.uid === "d").map((e) => e.start)).toEqual([
      "2026-10-13T11:00:00Z",
      "2026-10-14T11:00:00Z",
      "2026-10-15T11:00:00Z",
    ]);
    expect(daily.events.filter((e) => e.uid === "forever")).toHaveLength(500);
    expect(daily.report.truncated).toBe(1);
  });

  it("reads floating times in the file's zone, or else the home zone", () => {
    const event = ["BEGIN:VEVENT", "UID:f", "DTSTART:20261108T140000", "SUMMARY:F", "END:VEVENT"];
    const home = parseIcs(ics("BEGIN:VCALENDAR", ...event, "END:VCALENDAR"), opts);
    expect(home.events[0]!.start).toBe("2026-11-08T17:00:00Z");
    const file = parseIcs(ics("BEGIN:VCALENDAR", "X-WR-TIMEZONE:Europe/London", ...event, "END:VCALENDAR"), opts);
    expect(file.events[0]!.start).toBe("2026-11-08T14:00:00Z");
  });

  it("refuses what isn't iCalendar", () => {
    expect(() => parseIcs("BEGIN:VCARD\r\nEND:VCARD", opts)).toThrow(/not an iCalendar/);
  });

  it("reads durations", () => {
    expect(parseDuration("PT1H30M")).toBe(5_400_000);
    expect(parseDuration("P1W")).toBe(7 * 86_400_000);
    expect(parseDuration("nonsense")).toBeNull();
  });
});

describe("writeIcs", () => {
  it("writes what parseIcs reads back the same", () => {
    const read = parseIcs(
      ics(
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:weekly",
        "DTSTART;TZID=Europe/London:20261005T090000",
        "DURATION:PT1H",
        "RRULE:FREQ=WEEKLY;COUNT=3",
        "SUMMARY:Weekly\\, with a comma",
        "DESCRIPTION:Ünïcödé text that goes on long enough that the line has to be folded more than once, yes, more than once",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:day",
        "DTSTART;VALUE=DATE:20261024",
        "SUMMARY:Full moon",
        "END:VEVENT",
        "END:VCALENDAR",
      ),
      opts,
    );
    const text = writeIcs("Mine; mostly", read.events, new Date("2026-10-13T12:00:00Z"));
    expect(text.split("\r\n").every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
    const again = parseIcs(text, opts);
    expect(again.calendarName).toBe("Mine; mostly");
    expect(again.events).toEqual(read.events);
    expect(again.report.repeating).toBe(0);
  });
});
