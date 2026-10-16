import { describe, expect, it } from "vitest";
import type { Periods, Session } from "../shared/protocol.ts";
import { clockSkew, elapsed, livePeriods } from "./clock.ts";
import { clock, fromLocalInput, hours, localInput } from "./format.ts";

const running: Session = {
  id: "s",
  projectId: null,
  project: null,
  tags: [],
  startedAt: "2026-10-15T09:00:00Z",
  endedAt: null,
  zone: "UTC",
  day: "2026-10-15",
  stop: null,
  seconds: 60,
};

describe("formats", () => {
  it("shows clocks and totals in whole seconds and minutes", () => {
    expect([clock(0), clock(5415.9), clock(312 * 3600 + 5 * 60 + 41)]).toEqual(["0:00:00", "1:30:15", "312:05:41"]);
    expect([hours(30), hours(900), hours(7200), hours(5415)]).toEqual(["0m", "15m", "2h", "1h 30m"]);
  });

  it("reads datetime-local values back, with or without seconds", () => {
    const value = localInput("2026-10-15T09:12:03Z");
    expect(fromLocalInput(value)).toBe(Date.parse("2026-10-15T09:12:03Z"));
    expect(fromLocalInput(value.slice(0, 16))).toBe(Date.parse("2026-10-15T09:12:00Z"));
    expect(fromLocalInput("")).toBeNull();
  });
});

describe("the running clock", () => {
  it("counts from the start for as long as the session runs", () => {
    expect(elapsed(running, Date.parse("2026-10-15T10:30:15.999Z"))).toBe(5415);
    expect(elapsed(running, Date.parse("2026-10-17T09:00:00Z"))).toBe(48 * 3600);
    expect(elapsed({ ...running, endedAt: "2026-10-15T09:00:10Z" }, Date.parse("2026-10-16T03:00:00Z"))).toBe(10);
  });

  it("adds what the running session ran since the server counted", () => {
    const tally = { seconds: 100, sessions: 2 };
    const periods: Periods = { today: tally, week: tally, month: tally, overall: tally };
    const later = livePeriods(periods, running, Date.parse("2026-10-15T09:02:00Z"));
    expect(later.today).toEqual({ seconds: 160, sessions: 2 });
    expect(later.overall).toEqual({ seconds: 160, sessions: 2 });
    expect(livePeriods(periods, null, Date.parse("2026-10-15T09:02:00Z"))).toBe(periods);
  });

  it("ignores the small gaps a request makes between clocks", () => {
    expect(clockSkew("2026-10-15T09:00:00Z", Date.parse("2026-10-15T09:00:01.500Z"))).toBe(0);
    expect(clockSkew("2026-10-15T09:00:00Z", Date.parse("2026-10-15T08:59:30Z"))).toBe(30_000);
  });
});
