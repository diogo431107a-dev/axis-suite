import { describe, expect, it } from "vitest";
import {
  addMonths,
  addYears,
  isDate,
  isMonth,
  isoWeek,
  monthWeeks,
  weekLabel,
  weekStart,
  weekdayName,
} from "./dates.ts";
import {
  dayStart,
  daysTouched,
  fixedZone,
  isInstant,
  isZone,
  toInstant,
  toWall,
  zoneFromTzid,
  zoneOffset,
} from "./zones.ts";

describe("dates", () => {
  it("checks dates and months", () => {
    expect(isDate("2026-10-13")).toBe(true);
    expect(isDate("2026-02-29")).toBe(false);
    expect(isDate("2028-02-29")).toBe(true);
    expect(isDate("13/10/2026")).toBe(false);
    expect(isMonth("2026-10")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
  });

  it("counts ISO weeks, Monday first, with the week-year at New Year", () => {
    expect(weekLabel("2026-10-13")).toBe("2026-W42");
    expect(weekLabel("2026-12-31")).toBe("2026-W53");
    expect(weekLabel("2027-01-01")).toBe("2026-W53");
    expect(weekLabel("2027-01-03")).toBe("2026-W53");
    expect(weekLabel("2027-01-04")).toBe("2027-W01");
    expect(weekLabel("2024-12-30")).toBe("2025-W01");
    expect(isoWeek("2021-01-03")).toEqual({ year: 2020, week: 53 });
    expect(weekStart("2026-10-18")).toBe("2026-10-12");
    expect(weekdayName("2026-10-12")).toBe("Mon");
    expect(weekdayName("2026-10-18")).toBe("Sun");
  });

  it("lays out a month in Monday-first weeks", () => {
    const weeks = monthWeeks("2026-10");
    expect(weeks[0]![0]).toBe("2026-09-28");
    expect(weeks.at(-1)!.at(-1)).toBe("2026-11-01");
    expect(weeks).toHaveLength(5);
    // February 2027 starts on a Monday and has 28 days: exactly 4 weeks.
    expect(monthWeeks("2027-02")).toHaveLength(4);
    expect(monthWeeks("2026-08")).toHaveLength(6);
  });

  it("adds months and years", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addYears("2028-02-29", 1)).toBe("2029-02-28");
  });
});

describe("zones", () => {
  it("knows zones", () => {
    expect(isZone("America/Sao_Paulo")).toBe(true);
    expect(isZone("UTC+03:00")).toBe(true);
    expect(isZone("Mars/Olympus_Mons")).toBe(false);
    expect(fixedZone(-150)).toBe("UTC-02:30");
    expect(isInstant("2026-11-08T17:00:00Z")).toBe(true);
    expect(isInstant("2026-11-08T17:00:00.000Z")).toBe(false);
  });

  it("converts Sao Paulo, which has had no daylight saving time since 2019", () => {
    expect(toInstant("2026-11-08T14:00", "America/Sao_Paulo")).toBe("2026-11-08T17:00:00Z");
    expect(toWall("2026-11-08T17:00:00Z", "America/Sao_Paulo")).toEqual({
      date: "2026-11-08",
      time: "14:00",
      second: 0,
    });
    // Before 2019 it had: summer time began at midnight on 2018-11-04, so that day has no 00:00–00:59.
    expect(zoneOffset(Date.parse("2018-12-01T12:00:00Z"), "America/Sao_Paulo")).toBe(-120);
    expect(toInstant("2018-11-04T00:30", "America/Sao_Paulo")).toBe("2018-11-04T03:30:00Z");
    expect(dayStart("2018-11-04", "America/Sao_Paulo")).toBe("2018-11-04T03:00:00Z");
  });

  it("handles London's gap and overlap", () => {
    // 2026-03-29 01:00 → 02:00: 01:30 doesn't exist and moves on to 02:30 BST.
    expect(toInstant("2026-03-29T01:30", "Europe/London")).toBe("2026-03-29T01:30:00Z");
    expect(toWall("2026-03-29T01:30:00Z", "Europe/London").time).toBe("02:30");
    // 2026-10-25 02:00 → 01:00: 01:30 happens twice; the first is BST.
    expect(toInstant("2026-10-25T01:30", "Europe/London")).toBe("2026-10-25T00:30:00Z");
    expect(toInstant("2026-07-01T09:00", "Europe/London")).toBe("2026-07-01T08:00:00Z");
    expect(toInstant("2026-12-01T09:00", "Europe/London")).toBe("2026-12-01T09:00:00Z");
  });

  it("has days of 23 and 25 hours", () => {
    const hours = (date: string, next: string) =>
      (Date.parse(dayStart(next, "Europe/London")) - Date.parse(dayStart(date, "Europe/London"))) / 3_600_000;
    expect(hours("2026-03-29", "2026-03-30")).toBe(23);
    expect(hours("2026-10-25", "2026-10-26")).toBe(25);
  });

  it("converts UTC and fixed zones", () => {
    expect(toInstant("2026-11-08T14:00", "UTC")).toBe("2026-11-08T14:00:00Z");
    expect(toInstant("2026-11-08T14:00", "UTC+03:00")).toBe("2026-11-08T11:00:00Z");
    expect(toWall("2026-11-08T11:00:00Z", "UTC-03:00").time).toBe("08:00");
  });

  it("reads the zones of files", () => {
    expect(zoneFromTzid("America/Sao_Paulo")).toBe("America/Sao_Paulo");
    expect(zoneFromTzid("E. South America Standard Time")).toBe("America/Sao_Paulo");
    expect(zoneFromTzid("/mozilla.org/20050126_1/America/Sao_Paulo")).toBe("America/Sao_Paulo");
    expect(zoneFromTzid('"Europe/London"')).toBe("Europe/London");
    expect(zoneFromTzid("(UTC-03:00) Brasilia")).toBeNull();
  });

  it("finds the days an event touches", () => {
    const z = "America/Sao_Paulo";
    expect(daysTouched("2026-11-08T17:00:00Z", "2026-11-08T19:00:00Z", z)).toEqual({
      first: "2026-11-08",
      last: "2026-11-08",
    });
    // 22:00 to midnight: only the 8th.
    expect(daysTouched("2026-11-09T01:00:00Z", "2026-11-09T03:00:00Z", z)).toEqual({
      first: "2026-11-08",
      last: "2026-11-08",
    });
    // Across midnight: two days.
    expect(daysTouched("2026-11-09T01:00:00Z", "2026-11-09T05:00:00Z", z)).toEqual({
      first: "2026-11-08",
      last: "2026-11-09",
    });
    // A point in time at midnight belongs to the day it begins.
    expect(daysTouched("2026-11-09T03:00:00Z", "2026-11-09T03:00:00Z", z)).toEqual({
      first: "2026-11-09",
      last: "2026-11-09",
    });
  });
});
