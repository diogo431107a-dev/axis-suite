import { describe, expect, it } from "vitest";
import type { Periods, Session, Task } from "../shared/protocol.ts";
import { clockSkew, elapsed, livePeriods } from "./clock.ts";
import { clock, fromLocalInput, hours, localInput, sessionName } from "./format.ts";
import { tagsFor } from "./tasks.ts";

const running: Session = {
  id: "s",
  projectId: null,
  project: null,
  task: null,
  tags: [],
  startedAt: "2026-10-15T09:00:00Z",
  endedAt: null,
  zone: "UTC",
  day: "2026-10-15",
  stop: null,
  seconds: 60,
};

describe("resuming", () => {
  const tally = { seconds: 0, sessions: 0, longest: 0 };
  const periods: Periods = { today: tally, week: tally, month: tally, overall: tally };
  const task = (project: string | null, name: string | null, lastTags: string[]): Task => ({
    projectId: project && `id-${project}`,
    project,
    name,
    firstStartedAt: "2026-10-15T09:00:00Z",
    lastStartedAt: "2026-10-15T09:00:00Z",
    lastTags,
    periods,
  });
  // The latest used first.
  const tasks = [
    task("Printer", "Pull strings", ["hw"]),
    task("Admin", null, ["admin"]),
    task("Printer", "Mount chassis", ["hw", "chassis"]),
    task(null, "Tax return", ["money"]),
  ];

  it("takes the tags a task had last time, else its project's latest", () => {
    expect(tagsFor(tasks, "printer", " MOUNT chassis")).toEqual(["hw", "chassis"]);
    expect(tagsFor(tasks, "Printer", "Something new")).toEqual(["hw"]);
    expect(tagsFor(tasks, "Admin", "")).toEqual(["admin"]);
    expect(tagsFor(tasks, "", "tax return")).toEqual(["money"]);
    expect(tagsFor(tasks, "", "Something new")).toBeUndefined();
    expect(tagsFor(tasks, "New project", "")).toBeUndefined();
  });

  it("names a session by its task and project", () => {
    expect(sessionName({ project: "Printer", task: "Pull strings" })).toBe("Pull strings · Printer");
    expect(sessionName({ project: "Printer", task: null })).toBe("Printer");
    expect(sessionName({ project: null, task: null })).toBe("Unnamed");
  });
});

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

  it("adds what the running session ran since the server counted, which may make it the longest", () => {
    const tally = { seconds: 100, sessions: 2, longest: 90 };
    const periods: Periods = { today: tally, week: tally, month: tally, overall: tally };
    const later = livePeriods(periods, running, Date.parse("2026-10-15T09:02:00Z"), "2026-10-15");
    expect(later.today).toEqual({ seconds: 160, sessions: 2, longest: 120 });
    expect(later.overall).toEqual({ seconds: 160, sessions: 2, longest: 120 });
    expect(livePeriods(periods, null, Date.parse("2026-10-15T09:02:00Z"), "2026-10-15")).toBe(periods);
  });

  it("counts only today's part of a session that ran past midnight as today's longest", () => {
    const night = { ...running, startedAt: "2026-10-15T23:00:00Z", day: "2026-10-15", seconds: 3600 };
    const tally = { seconds: 0, sessions: 1, longest: 1500 };
    const periods: Periods = { today: tally, week: tally, month: tally, overall: tally };
    const later = livePeriods(periods, night, Date.parse("2026-10-16T00:30:00Z"), "2026-10-16");
    expect(later.today.longest).toBe(1800);
    expect(later.overall.longest).toBe(5400);
  });

  it("ignores the small gaps a request makes between clocks", () => {
    expect(clockSkew("2026-10-15T09:00:00Z", Date.parse("2026-10-15T09:00:01.500Z"))).toBe(0);
    expect(clockSkew("2026-10-15T09:00:00Z", Date.parse("2026-10-15T08:59:30Z"))).toBe(30_000);
  });
});
