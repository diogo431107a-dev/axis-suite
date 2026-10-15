import { describe, expect, it } from "vitest";
import { sessionBounds } from "./cutoff.ts";
import { addDays, isDate, monthOf, weekStart } from "./dates.ts";
import { instantOf, isInstant, toInstantMs, zoneName } from "./zones.ts";

/** sessionBounds for a start on the wall clock of `zone`, with the stop as an instant. */
function bounds(wall: string, zone: string) {
  const { day, cutoffMs } = sessionBounds(toInstantMs(wall, zone), zone);
  return { day, cutoff: instantOf(cutoffMs) };
}

describe("automatic stops", () => {
  // London is on summer time (UTC+1) until 25 October 2026.
  const london = "Europe/London";

  it("stops a daytime session at the next midnight", () => {
    expect(bounds("2026-10-15T09:00", london)).toEqual({ day: "2026-10-15", cutoff: "2026-10-15T23:00:00Z" });
    expect(bounds("2026-10-15T00:00:00", london)).toEqual({ day: "2026-10-15", cutoff: "2026-10-15T23:00:00Z" });
    expect(bounds("2026-10-15T21:59:59", london)).toEqual({ day: "2026-10-15", cutoff: "2026-10-15T23:00:00Z" });
  });

  it("lets a session started at 22:00 or later run until 05:00, counting for the day it started", () => {
    expect(bounds("2026-10-15T22:00:00", london)).toEqual({ day: "2026-10-15", cutoff: "2026-10-16T04:00:00Z" });
    expect(bounds("2026-10-15T23:59:59", london)).toEqual({ day: "2026-10-15", cutoff: "2026-10-16T04:00:00Z" });
  });

  it("gives a session started after midnight the whole day", () => {
    expect(bounds("2026-10-16T00:30", london)).toEqual({ day: "2026-10-16", cutoff: "2026-10-16T23:00:00Z" });
    expect(bounds("2026-10-16T04:59", london)).toEqual({ day: "2026-10-16", cutoff: "2026-10-16T23:00:00Z" });
  });

  it("follows the clocks when they change in the night", () => {
    // London goes back from 02:00 summer time to 01:00 winter time on 25 October 2026.
    expect(bounds("2026-10-24T09:00", london)).toEqual({ day: "2026-10-24", cutoff: "2026-10-24T23:00:00Z" });
    expect(bounds("2026-10-24T22:30", london)).toEqual({ day: "2026-10-24", cutoff: "2026-10-25T05:00:00Z" });
    // New York jumps from 02:00 to 03:00 on 8 March 2026.
    const newYork = "America/New_York";
    expect(bounds("2026-03-07T23:00", newYork)).toEqual({ day: "2026-03-07", cutoff: "2026-03-08T09:00:00Z" });
    expect(bounds("2026-03-08T01:30", newYork)).toEqual({ day: "2026-03-08", cutoff: "2026-03-09T04:00:00Z" });
  });

  it("works in São Paulo, which has no summer time", () => {
    const saoPaulo = "America/Sao_Paulo";
    expect(bounds("2026-10-15T08:00", saoPaulo)).toEqual({ day: "2026-10-15", cutoff: "2026-10-16T03:00:00Z" });
    expect(bounds("2026-10-15T22:15", saoPaulo)).toEqual({ day: "2026-10-15", cutoff: "2026-10-16T08:00:00Z" });
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
