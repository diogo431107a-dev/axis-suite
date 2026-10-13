import { describe, expect, it } from "vitest";
import { monthWeeks } from "../shared/dates.ts";
import type { CalEvent } from "../shared/protocol.ts";
import { dayHeading, sourceText, whenText } from "./format.ts";
import { parseDateInput, parseTimeInput } from "./inputs/parse.ts";
import { layoutWeek } from "./month/layout.ts";
import { parseRoute, pathOf } from "./nav.ts";

const Z = "America/Sao_Paulo";
let n = 0;
const ev = (over: Partial<CalEvent>): CalEvent => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  calendarId: "c",
  uid: "u",
  recurrenceId: "",
  origin: "user",
  title: "E",
  allDay: false,
  start: "2026-10-14T12:00:00Z",
  end: "2026-10-14T13:00:00Z",
  sourceZone: null,
  location: "",
  description: "",
  url: "",
  rev: 1,
  createdAt: "",
  updatedAt: "",
  ...over,
});

describe("format", () => {
  it("writes dates and times the ISO way", () => {
    expect(dayHeading("2026-10-13")).toBe("2026-10-13 Tue · W42");
    expect(whenText(ev({}), Z)).toBe("2026-10-14 09:00–10:00");
    expect(whenText(ev({ end: "2026-10-14T12:00:00Z" }), Z)).toBe("2026-10-14 09:00");
    expect(whenText(ev({ end: "2026-10-15T12:00:00Z" }), Z)).toBe("2026-10-14 09:00 – 2026-10-15 09:00");
    expect(whenText(ev({ allDay: true, start: "2026-10-14", end: "2026-10-15" }), Z)).toBe("2026-10-14, all day");
    expect(whenText(ev({ allDay: true, start: "2026-10-14", end: "2026-10-17" }), Z)).toBe("2026-10-14 – 2026-10-16");
  });

  it("shows the file's zone only when its clocks differ", () => {
    const race = ev({ start: "2026-11-08T17:00:00Z", end: "2026-11-08T19:00:00Z", sourceZone: "UTC" });
    expect(sourceText(race, Z)).toBe("In UTC: 2026-11-08 17:00–19:00");
    expect(sourceText({ ...race, sourceZone: "America/Bahia" }, Z)).toBeNull();
    expect(sourceText({ ...race, sourceZone: Z }, Z)).toBeNull();
  });
});

describe("inputs", () => {
  it("reads dates and times leniently", () => {
    expect(parseDateInput("2026-10-13")).toBe("2026-10-13");
    expect(parseDateInput("20261013")).toBe("2026-10-13");
    expect(parseDateInput("2026-1-3")).toBe("2026-01-03");
    expect(parseDateInput("13/10/2026")).toBeNull();
    expect(parseDateInput("2026-02-30")).toBeNull();
    expect(parseTimeInput("14:00")).toBe("14:00");
    expect(parseTimeInput("1400")).toBe("14:00");
    expect(parseTimeInput("930")).toBe("09:30");
    expect(parseTimeInput("9")).toBe("09:00");
    expect(parseTimeInput("24:00")).toBeNull();
    expect(parseTimeInput("2 PM")).toBeNull();
  });
});

describe("layoutWeek", () => {
  const week = monthWeeks("2026-10")[2]!; // 2026-10-12 … 2026-10-18

  it("puts spanning events in lanes and the rest under their day", () => {
    const long = ev({ allDay: true, start: "2026-10-10", end: "2026-10-14" }); // to the 13th
    const short = ev({ allDay: true, start: "2026-10-13", end: "2026-10-16" }); // 13th–15th
    const later = ev({ allDay: true, start: "2026-10-14", end: "2026-10-15" }); // 14th
    const night = ev({ start: "2026-10-16T01:00:00Z", end: "2026-10-16T05:00:00Z" }); // 22:00 15th – 02:00 16th
    const lunch = ev({ start: "2026-10-14T15:00:00Z", end: "2026-10-14T16:00:00Z" });
    const breakfast = ev({ start: "2026-10-14T11:00:00Z", end: "2026-10-14T12:00:00Z" });
    const layout = layoutWeek(week, [lunch, long, short, later, night, breakfast], Z);
    const bars = Object.fromEntries(layout.bars.map((b) => [b.event.id, [b.col, b.span, b.lane, b.before, b.after]]));
    expect(bars[long.id]).toEqual([0, 2, 0, true, false]);
    expect(bars[short.id]).toEqual([1, 3, 1, false, false]);
    expect(bars[later.id]).toEqual([2, 1, 0, false, false]);
    expect(bars[night.id]).toEqual([3, 2, 0, false, false]);
    expect(layout.lanes).toBe(2);
    expect(layout.lines[2]!.map((e) => e.id)).toEqual([breakfast.id, lunch.id]);
  });

  it("leaves out events of other weeks", () => {
    const layout = layoutWeek(week, [ev({ allDay: true, start: "2026-10-19", end: "2026-10-20" })], Z);
    expect(layout.bars).toEqual([]);
  });
});

describe("routes", () => {
  it("round-trips", () => {
    const id = "0e5ad2a3-6c5b-4a8e-9b1d-0a1b2c3d4e5f";
    for (const path of [
      "/",
      "/month/2026-10",
      "/agenda",
      `/agenda?event=${id}`,
      `/?edit=${id}`,
      "/month/2026-10?new=2026-10-13",
    ]) {
      const [pathname, search = ""] = path.split("?");
      expect(pathOf(parseRoute({ pathname: pathname!, search: search ? `?${search}` : "" }))).toBe(path);
    }
    expect(parseRoute({ pathname: "/month/2026-13", search: "" }).view).toEqual({ kind: "month", month: null });
  });
});
