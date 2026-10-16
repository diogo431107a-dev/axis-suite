import { describe, expect, it } from "vitest";
import { addDays, isDate, monthOf, weekStart } from "./dates.ts";
import { daySpans, lastDayOf } from "./days.ts";
import { isInstant, toInstantMs, zoneName } from "./zones.ts";

/** daySpans for a session between two times on the wall clock of `zone`. */
const spans = (from: string, to: string, zone: string) =>
  daySpans(toInstantMs(from, zone), toInstantMs(to, zone), zone);

const H = 3600;

describe("days a session has time in", () => {
  // London is on summer time (UTC+1) until 25 October 2026.
  const london = "Europe/London";

  it("gives a session within a day all to that day", () => {
    expect(spans("2026-10-15T09:00", "2026-10-15T17:30", london)).toEqual([{ day: "2026-10-15", seconds: 8.5 * H }]);
    expect(spans("2026-10-15T00:00", "2026-10-16T00:00", london)).toEqual([{ day: "2026-10-15", seconds: 24 * H }]);
  });

  it("splits a session at each midnight, however long it runs", () => {
    expect(spans("2026-10-15T22:30", "2026-10-16T01:15", london)).toEqual([
      { day: "2026-10-15", seconds: 1.5 * H },
      { day: "2026-10-16", seconds: 1.25 * H },
    ]);
    expect(spans("2026-10-15T18:00", "2026-10-18T06:00", london).map((s) => s.seconds / H)).toEqual([6, 24, 24, 6]);
  });

  it("counts a session of no length on its day", () => {
    expect(spans("2026-10-15T09:00", "2026-10-15T09:00", london)).toEqual([{ day: "2026-10-15", seconds: 0 }]);
  });

  it("ends a session's days with its last second", () => {
    const start = toInstantMs("2026-10-15T22:00", london);
    expect(lastDayOf(start, toInstantMs("2026-10-16T00:00", london), london)).toBe("2026-10-15");
    expect(lastDayOf(start, toInstantMs("2026-10-16T00:00:01", london), london)).toBe("2026-10-16");
    expect(lastDayOf(start, start, london)).toBe("2026-10-15");
  });

  it("follows the clocks when they change in the night", () => {
    // London goes back from 02:00 summer time to 01:00 winter time on 25 October 2026: a day of 25 hours.
    expect(spans("2026-10-24T23:00", "2026-10-26T01:00", london).map((s) => s.seconds / H)).toEqual([1, 25, 1]);
    // New York jumps from 02:00 to 03:00 on 8 March 2026: a day of 23 hours.
    const newYork = "America/New_York";
    expect(spans("2026-03-07T23:00", "2026-03-09T01:00", newYork).map((s) => s.seconds / H)).toEqual([1, 23, 1]);
  });

  it("works in São Paulo, which has no summer time", () => {
    expect(spans("2026-10-15T23:00", "2026-10-16T02:00", "America/Sao_Paulo")).toEqual([
      { day: "2026-10-15", seconds: H },
      { day: "2026-10-16", seconds: 2 * H },
    ]);
  });
});

describe("days and zones", () => {
  it("starts weeks on Monday", () => {
    expect(weekStart("2026-10-15")).toBe("2026-10-12");
    expect(weekStart("2026-10-12")).toBe("2026-10-12");
    expect(weekStart("2026-10-18")).toBe("2026-10-12");
    expect(weekStart("2026-11-01")).toBe("2026-10-26");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(monthOf("2026-10-15")).toBe("2026-10");
  });

  it("checks dates, instants and zones", () => {
    expect([isDate("2026-02-28"), isDate("2026-02-29"), isDate("2026-1-5"), isDate(20261015)]).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect([isInstant("2026-10-15T09:00:00Z"), isInstant("2026-10-15T09:00:00.000Z"), isInstant("2026-10-15")]).toEqual(
      [true, false, false],
    );
    expect(zoneName("america/sao_paulo")).toBe("America/Sao_Paulo");
    expect([zoneName("Mars/Olympus"), zoneName(""), zoneName(3)]).toEqual([null, null, null]);
  });
});
