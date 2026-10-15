import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db.ts";
import { StoreError, createStore, type Store } from "./store.ts";

/** The StoreError a call throws (fails the test if it doesn't throw one). */
function refusal(fn: () => unknown): StoreError {
  try {
    fn();
  } catch (err) {
    if (err instanceof StoreError) return err;
    throw err;
  }
  throw new Error("expected a StoreError");
}

// Most tests run in UTC, where the wall clock is the instant.
const UTC = "UTC";
let db: DatabaseSync;
let store: Store;
let now: number;

/** Sets the clock: "2026-10-15T09:00" (UTC). */
const at = (wall: string) => {
  now = Date.parse(`${wall.length === 16 ? `${wall}:00` : wall}Z`);
};

/** A session from `from` to `to` (UTC wall clock), in a project or none. */
function session(from: string, to: string, project: string | null = null, tags: string[] = []) {
  at(from);
  store.start("alice", { zone: UTC, project, tags });
  at(to);
  return store.stop("alice");
}

const state = (today: string, project?: string) => store.state("alice", { today, project });

beforeEach(() => {
  db = openDatabase(":memory:");
  at("2026-10-15T09:00");
  store = createStore(db, () => now);
});

describe("play and stop", () => {
  it("starts one session at a time, however many times Play is pressed", () => {
    const first = store.start("alice", { zone: UTC, project: "Axis", tags: ["#Code", "code", " bugs "] });
    expect(first).toMatchObject({
      project: "Axis",
      tags: ["code", "bugs"],
      startedAt: "2026-10-15T09:00:00Z",
      endedAt: null,
      cutoffAt: "2026-10-16T00:00:00Z",
      day: "2026-10-15",
      stop: null,
      seconds: 0,
    });
    at("2026-10-15T09:05");
    const again = store.start("alice", { zone: UTC, project: "Other" });
    expect(again.id).toBe(first.id);
    expect(again.project).toBe("Axis");
    expect(again.seconds).toBe(300);
    // Someone else's timer is their own.
    expect(store.start("bob", { zone: UTC }).id).not.toBe(first.id);
  });

  it("stops, and says so when nothing runs", () => {
    store.start("alice", { zone: UTC });
    at("2026-10-15T10:30:15");
    expect(store.stop("alice")).toMatchObject({ endedAt: "2026-10-15T10:30:15Z", stop: "manual", seconds: 5415 });
    const err = refusal(() => store.stop("alice"));
    expect([err.status, err.code]).toEqual([409, "not-running"]);
  });

  it("needs the browser's time zone", () => {
    expect(refusal(() => store.start("alice", {})).code).toBe("invalid");
    expect(refusal(() => store.start("alice", { zone: "Mars/Olympus" })).code).toBe("invalid");
    expect(store.start("alice", { zone: "america/sao_paulo" }).zone).toBe("America/Sao_Paulo");
  });
});

describe("automatic stops", () => {
  it("counts a forgotten session up to midnight, then writes the stop down", () => {
    store.start("alice", { zone: UTC });
    at("2026-10-15T23:59:59");
    expect(store.closeExpired()).toEqual([]);
    at("2026-10-16T03:00");
    expect(store.closeExpired()).toEqual(["alice"]);
    expect(store.closeExpired()).toEqual([]);
    const s = state("2026-10-16");
    expect(s.running).toBeNull();
    expect(s.last).toMatchObject({ endedAt: "2026-10-16T00:00:00Z", stop: "auto", seconds: 15 * 3600 });
  });

  it("stops by itself when the timer is next looked at", () => {
    store.start("alice", { zone: UTC });
    at("2026-10-16T08:00");
    const s = state("2026-10-16");
    expect(s.running).toBeNull();
    expect(s.last?.stop).toBe("auto");
    // A new day, a new session.
    expect(store.start("alice", { zone: UTC }).day).toBe("2026-10-16");
  });

  it("lets a late session run until 05:00", () => {
    at("2026-10-15T22:30");
    store.start("alice", { zone: UTC });
    at("2026-10-16T04:59:59");
    expect(state("2026-10-16").running?.seconds).toBe(6 * 3600 + 29 * 60 + 59);
    at("2026-10-16T05:00:01");
    expect(state("2026-10-16").last).toMatchObject({ stop: "auto", seconds: 6.5 * 3600 });
  });
});

describe("stats", () => {
  it("counts each session for the day it started, in its week and month", () => {
    // Sunday 18 October, 23:00 to Monday 01:00: Sunday's, and the week of 12–18 October.
    session("2026-10-18T23:00", "2026-10-19T01:00");
    let s = state("2026-10-19");
    expect([s.all.today, s.all.week]).toEqual([
      { seconds: 0, sessions: 0 },
      { seconds: 0, sessions: 0 },
    ]);
    expect(s.all.month).toEqual({ seconds: 7200, sessions: 1 });
    s = state("2026-10-18");
    expect([s.all.today, s.all.week]).toEqual([
      { seconds: 7200, sessions: 1 },
      { seconds: 7200, sessions: 1 },
    ]);
    // 31 October 23:00 to 1 November 01:00: October's.
    session("2026-10-31T23:00", "2026-11-01T01:00");
    expect(state("2026-11-01").all.month).toEqual({ seconds: 0, sessions: 0 });
    expect(state("2026-10-31").all.month).toEqual({ seconds: 14_400, sessions: 2 });
    expect(state("2026-11-01").all.overall).toEqual({ seconds: 14_400, sessions: 2 });
  });

  it("counts every session as an interruption, the running one and automatic stops included", () => {
    session("2026-10-15T09:00", "2026-10-15T10:00", "Axis");
    session("2026-10-15T10:15", "2026-10-15T10:45", "Mail");
    at("2026-10-15T11:00");
    store.start("alice", { zone: UTC, project: "Axis" });
    at("2026-10-15T11:30");
    // Without ?project=, the running session's project.
    const s = state("2026-10-15");
    expect(s.all.today).toEqual({ seconds: 3600 + 1800 + 1800, sessions: 3 });
    expect(s.project).toMatchObject({ name: "Axis", periods: { today: { seconds: 3600 + 1800, sessions: 2 } } });
    expect(s.running?.seconds).toBe(1800);
    expect(s.last?.project).toBe("Mail");
    const mail = store.projects("alice", { day: "2026-10-15" }).find((p) => p.name === "Mail")!;
    expect(state("2026-10-15", mail.id).project?.periods.today).toEqual({ seconds: 1800, sessions: 1 });
  });

  it("keeps the running session's day while it runs past midnight", () => {
    at("2026-10-15T23:00");
    store.start("alice", { zone: UTC });
    at("2026-10-16T01:00");
    const s = state("2026-10-16");
    expect(s.day).toBe("2026-10-15");
    expect(s.all.today).toEqual({ seconds: 7200, sessions: 1 });
  });

  it("knows which sessions still need a project", () => {
    const s1 = session("2026-10-15T09:00", "2026-10-15T10:00");
    session("2026-10-15T10:00", "2026-10-15T11:00", "Axis");
    expect(state("2026-10-15").unnamed).toBe(1);
    expect(store.updateSession("alice", s1.id, { project: "axis", tags: ["review"] })).toMatchObject({
      project: "Axis",
      tags: ["review"],
    });
    expect(state("2026-10-15").unnamed).toBe(0);
    expect(store.tags("alice")).toEqual([{ tag: "review", count: 1 }]);
  });
});

describe("corrections", () => {
  it("only shortens a session", () => {
    const s = session("2026-10-15T09:00", "2026-10-15T12:00");
    const earlier = refusal(() => store.updateSession("alice", s.id, { startedAt: "2026-10-15T08:59:59Z" }));
    expect(earlier.message).toMatch(/start can't move earlier/);
    const later = refusal(() => store.updateSession("alice", s.id, { endedAt: "2026-10-15T12:00:01Z" }));
    expect(later.message).toMatch(/end can't move later/);
    expect(
      refusal(() =>
        store.updateSession("alice", s.id, { startedAt: "2026-10-15T11:00:00Z", endedAt: "2026-10-15T11:00:00Z" }),
      ).message,
    ).toMatch(/end after it starts/);
    expect(refusal(() => store.updateSession("alice", s.id, { endedAt: "noon" })).code).toBe("invalid");
    expect(
      store.updateSession("alice", s.id, { startedAt: "2026-10-15T09:30:00Z", endedAt: "2026-10-15T11:00:00Z" }),
    ).toMatchObject({ seconds: 5400, day: "2026-10-15", stop: "manual" });
  });

  it("trims a running session: its start later, or its end, which stops it", () => {
    at("2026-10-15T15:00");
    const s = store.start("alice", { zone: UTC });
    at("2026-10-15T18:00");
    expect(store.updateSession("alice", s.id, { startedAt: "2026-10-15T15:10:00Z" }).seconds).toBe(2 * 3600 + 50 * 60);
    expect(refusal(() => store.updateSession("alice", s.id, { endedAt: "2026-10-15T18:00:01Z" })).code).toBe("invalid");
    expect(store.updateSession("alice", s.id, { endedAt: "2026-10-15T17:00:00Z" })).toMatchObject({
      endedAt: "2026-10-15T17:00:00Z",
      stop: "manual",
    });
    expect(state("2026-10-15").running).toBeNull();
  });

  it("deletes a session, the running one too", () => {
    const s = session("2026-10-15T09:00", "2026-10-15T10:00");
    store.start("alice", { zone: UTC });
    const running = state("2026-10-15").running!;
    store.deleteSession("alice", running.id);
    store.deleteSession("alice", s.id);
    expect(state("2026-10-15").all.overall).toEqual({ seconds: 0, sessions: 0 });
    expect(refusal(() => store.deleteSession("alice", s.id)).status).toBe(404);
  });

  it("keeps each user's sessions apart", () => {
    const s = session("2026-10-15T09:00", "2026-10-15T10:00");
    expect(refusal(() => store.updateSession("bob", s.id, { project: "Mine" })).status).toBe(404);
    expect(refusal(() => store.deleteSession("bob", s.id)).status).toBe(404);
    expect(store.sessions("bob", {}).sessions).toEqual([]);
  });
});

describe("history", () => {
  it("lists days of sessions, newest first, a page at a time", () => {
    for (let d = 1; d <= 20; d++) {
      const day = `2026-10-${String(d).padStart(2, "0")}`;
      session(`${day}T09:00`, `${day}T10:00`, d % 2 ? "Axis" : null);
    }
    const first = store.sessions("alice", {});
    expect(first.sessions.map((s) => s.day)).toEqual(
      Array.from({ length: 14 }, (_, i) => `2026-10-${String(20 - i).padStart(2, "0")}`),
    );
    expect(first.next).toBe("2026-10-07");
    const second = store.sessions("alice", { before: first.next });
    expect(second.sessions).toHaveLength(6);
    expect(second.next).toBeNull();
    expect(store.sessions("alice", { unnamed: "1" }).sessions.every((s) => s.project === null)).toBe(true);
  });

  it("exports every session as CSV", () => {
    session("2026-10-15T09:00", "2026-10-15T10:30", '=Sum, "quoted"', ["code"]);
    expect(store.exportCsv("alice").split("\r\n")).toEqual([
      "day,start,end,zone,seconds,hours,project,tags,stop",
      `2026-10-15,2026-10-15 09:00:00,2026-10-15 10:30:00,UTC,5400,1.50,"'=Sum, ""quoted""",code,manual`,
      "",
    ]);
  });
});

describe("projects", () => {
  it("finds projects by name ignoring case, and brings archived ones back", () => {
    session("2026-10-15T09:00", "2026-10-15T10:00", "Axis");
    const [axis] = store.projects("alice", { day: "2026-10-15" });
    store.updateProject("alice", axis!.id, { archived: true });
    expect(store.projects("alice", { day: "2026-10-15" })[0]?.archived).toBe(true);
    const s = session("2026-10-15T11:00", "2026-10-15T12:00", "AXIS");
    expect(s.projectId).toBe(axis!.id);
    expect(store.projects("alice", { day: "2026-10-15" })).toMatchObject([
      {
        name: "Axis",
        archived: false,
        lastUsedAt: "2026-10-15T11:00:00Z",
        periods: { today: { seconds: 7200, sessions: 2 } },
      },
    ]);
  });

  it("refuses another project's name, unless merging into it", () => {
    session("2026-10-15T09:00", "2026-10-15T10:00", "Axis");
    session("2026-10-15T10:00", "2026-10-15T10:30", "axsi");
    const byName = () => new Map(store.projects("alice", { day: "2026-10-15" }).map((p) => [p.name, p]));
    const typo = byName().get("axsi")!;
    const err = refusal(() => store.updateProject("alice", typo.id, { name: "AXIS" }));
    expect([err.status, err.code]).toEqual([409, "exists"]);
    // A project can change its own name's case.
    store.updateProject("alice", typo.id, { name: "Axsi" });
    const { id } = store.updateProject("alice", typo.id, { name: "axis", merge: true });
    expect(id).toBe(byName().get("Axis")!.id);
    expect([...byName().keys()]).toEqual(["Axis"]);
    expect(byName().get("Axis")!.periods.today).toEqual({ seconds: 5400, sessions: 2 });
  });

  it("keeps a log of the estimate's changes", () => {
    session("2026-10-15T09:00", "2026-10-15T10:00", "Axis");
    const id = store.projects("alice", { day: "2026-10-15" })[0]!.id;
    store.updateProject("alice", id, { estimate: 20 * 3600 });
    at("2026-10-16T09:00");
    store.updateProject("alice", id, { estimate: 40 * 3600 });
    store.updateProject("alice", id, { estimate: 40 * 3600 });
    expect(refusal(() => store.updateProject("alice", id, { estimate: 1.5 })).code).toBe("invalid");
    expect(store.projects("alice", { day: "2026-10-16" })[0]).toMatchObject({
      estimate: 40 * 3600,
      estimateLog: [
        { at: "2026-10-15T10:00:00Z", from: null, to: 72_000 },
        { at: "2026-10-16T09:00:00Z", from: 72_000, to: 144_000 },
      ],
    });
  });

  it("deletes only a project without sessions", () => {
    const s = session("2026-10-15T09:00", "2026-10-15T10:00", "Axis");
    store.updateProject("alice", s.projectId!, { estimate: 3600 });
    expect(refusal(() => store.deleteProject("alice", s.projectId!)).code).toBe("not-empty");
    store.deleteSession("alice", s.id);
    // Its estimate keeps it…
    expect(store.projects("alice", { day: "2026-10-15" })).toHaveLength(1);
    store.deleteProject("alice", s.projectId!);
    expect(store.projects("alice", { day: "2026-10-15" })).toEqual([]);
  });

  it("drops a project nothing is left in, such as a typo", () => {
    at("2026-10-15T09:00");
    const s = store.start("alice", { zone: UTC, project: "Axsi" });
    store.updateSession("alice", s.id, { project: "Axis" });
    expect(store.projects("alice", { day: "2026-10-15" }).map((p) => p.name)).toEqual(["Axis"]);
    store.deleteSession("alice", s.id);
    expect(store.projects("alice", { day: "2026-10-15" })).toEqual([]);
  });
});

it("deletes everything of users no longer in Heimdall", () => {
  session("2026-10-15T09:00", "2026-10-15T10:00", "Axis");
  at("2026-10-15T11:00");
  store.start("bob", { zone: UTC, project: "Bob's" });
  expect(store.removeUnknownOwners(new Set(["alice"]))).toEqual([{ owner: "bob", sessions: 1, projects: 1 }]);
  expect(store.state("bob", { today: "2026-10-15" }).all.overall.sessions).toBe(0);
  expect(state("2026-10-15").all.overall.sessions).toBe(1);
});
