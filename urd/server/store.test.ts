import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

/** A session from `from` to `to` (UTC wall clock), in a project and a task, or none. */
function session(from: string, to: string, project: string | null = null, tags: string[] = [], task?: string) {
  at(from);
  store.start("alice", { zone: UTC, project, tags, task });
  at(to);
  return store.stop("alice");
}

const state = (today: string, project?: string, task?: string) => store.state("alice", { today, project, task });

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

describe("no automatic stop", () => {
  it("lets a session run until it is stopped, for days if need be", () => {
    store.start("alice", { zone: UTC });
    at("2026-10-18T09:00");
    const s = state("2026-10-18");
    expect(s.running).toMatchObject({ endedAt: null, stop: null, seconds: 72 * 3600 });
    expect(s.all.today).toMatchObject({ seconds: 9 * 3600, sessions: 1 });
    expect(s.all.overall).toMatchObject({ seconds: 72 * 3600, sessions: 1 });
    expect(store.stop("alice")).toMatchObject({ stop: "manual", seconds: 72 * 3600 });
  });
});

describe("stats", () => {
  it("splits a session's time at midnight, counting it in every period it has time in", () => {
    // Sunday 18 October, 23:00 to Monday 01:00: an hour in each day, and in each week.
    session("2026-10-18T23:00", "2026-10-19T01:00");
    let s = state("2026-10-19");
    expect([s.all.today, s.all.week, s.all.month]).toMatchObject([
      { seconds: 3600, sessions: 1 },
      { seconds: 3600, sessions: 1 },
      { seconds: 7200, sessions: 1 },
    ]);
    s = state("2026-10-18");
    expect([s.all.today, s.all.week]).toMatchObject([
      { seconds: 3600, sessions: 1 },
      { seconds: 3600, sessions: 1 },
    ]);
    // 31 October 23:00 to 1 November 01:00: an hour in each month.
    session("2026-10-31T23:00", "2026-11-01T01:00");
    expect(state("2026-11-01").all.month).toMatchObject({ seconds: 3600, sessions: 1 });
    expect(state("2026-10-31").all.month).toMatchObject({ seconds: 10_800, sessions: 2 });
    expect(state("2026-11-01").all.overall).toMatchObject({ seconds: 14_400, sessions: 2 });
  });

  it("splits in the time zone a session was started in", () => {
    // 22:00 to 02:00 in São Paulo (UTC−3) is 01:00 to 05:00 UTC: all of it on the 16th in UTC.
    at("2026-10-16T01:00");
    store.start("alice", { zone: "America/Sao_Paulo" });
    at("2026-10-16T05:00");
    expect(store.stop("alice").day).toBe("2026-10-15");
    expect(state("2026-10-15").all.today).toMatchObject({ seconds: 7200, sessions: 1 });
    expect(state("2026-10-16").all.today).toMatchObject({ seconds: 7200, sessions: 1 });
  });

  it("counts every session as an interruption, the running one included", () => {
    session("2026-10-15T09:00", "2026-10-15T10:00", "Axis");
    session("2026-10-15T10:15", "2026-10-15T10:45", "Mail");
    at("2026-10-15T11:00");
    store.start("alice", { zone: UTC, project: "Axis" });
    at("2026-10-15T11:30");
    // Without ?project=, the running session's project.
    const s = state("2026-10-15");
    expect(s.all.today).toMatchObject({ seconds: 3600 + 1800 + 1800, sessions: 3 });
    expect(s.project).toMatchObject({ name: "Axis", periods: { today: { seconds: 3600 + 1800, sessions: 2 } } });
    expect(s.running?.seconds).toBe(1800);
    expect(s.last?.project).toBe("Mail");
    const mail = store.projects("alice", { day: "2026-10-15" }).find((p) => p.name === "Mail")!;
    expect(state("2026-10-15", mail.id).project?.periods.today).toMatchObject({ seconds: 1800, sessions: 1 });
  });

  it("finds the longest uninterrupted work of each period, by its part in the period", () => {
    session("2026-10-12T09:00", "2026-10-12T11:30", "Axis", [], "Long");
    session("2026-10-15T09:00", "2026-10-15T09:40", "Axis");
    session("2026-10-15T10:00", "2026-10-15T11:00", "Mail");
    // 23:00 to 01:30: 1 hour on the 15th, 1.5 hours on the 16th.
    session("2026-10-15T23:00", "2026-10-16T01:30", "Axis");
    const s = state("2026-10-15");
    expect([s.all.today.longest, s.all.week.longest, s.all.overall.longest]).toEqual([3600, 9000, 9000]);
    expect(state("2026-10-16").all.today.longest).toBe(5400);
    const axis = store.projects("alice", { day: "2026-10-15" }).find((p) => p.name === "Axis")!;
    expect(axis.periods.today).toEqual({ seconds: 2400 + 3600, sessions: 2, longest: 3600 });
    expect(state("2026-10-15", axis.id, "long").task?.periods.week).toEqual({
      seconds: 9000,
      sessions: 1,
      longest: 9000,
    });
    expect(state("2026-10-14").all.today).toEqual({ seconds: 0, sessions: 0, longest: 0 });
  });

  it("moves on to the new day while a session runs past midnight", () => {
    at("2026-10-15T23:00");
    store.start("alice", { zone: UTC });
    at("2026-10-16T01:30");
    const s = state("2026-10-16");
    expect(s.day).toBe("2026-10-16");
    expect(s.all.today).toMatchObject({ seconds: 5400, sessions: 1 });
    expect(s.running?.seconds).toBe(9000);
  });

  it("knows which sessions still need a name: a project or a task", () => {
    const s1 = session("2026-10-15T09:00", "2026-10-15T10:00");
    session("2026-10-15T10:00", "2026-10-15T11:00", "Axis");
    session("2026-10-15T11:00", "2026-10-15T11:30", null, [], "Tax return");
    expect(state("2026-10-15").unnamed).toBe(1);
    expect(store.sessions("alice", { unnamed: "1" }).sessions.map((s) => s.id)).toEqual([s1.id]);
    expect(store.updateSession("alice", s1.id, { project: "axis", tags: ["review"] })).toMatchObject({
      project: "Axis",
      tags: ["review"],
    });
    expect(state("2026-10-15").unnamed).toBe(0);
    expect(store.tags("alice")).toEqual([{ tag: "review", count: 1 }]);
  });
});

describe("tasks", () => {
  const tasks = () => store.tasks("alice", { day: "2026-10-15" });

  it("tracks tasks in a project or on their own, spelled as they were first", () => {
    session("2026-10-15T09:00", "2026-10-15T09:14", "Printer");
    session("2026-10-15T10:00", "2026-10-15T10:30", "Printer", ["hw"], "Mount printhead");
    const again = session("2026-10-15T11:00", "2026-10-15T11:10", "printer", ["hw", "fix"], "mount  PRINTHEAD ");
    expect(again).toMatchObject({ project: "Printer", task: "Mount printhead" });
    session("2026-10-15T12:00", "2026-10-15T12:40", null, ["admin"], "Tax return");
    session("2026-10-15T13:00", "2026-10-15T13:05");
    expect(tasks()).toMatchObject([
      { project: null, name: null, periods: { overall: { seconds: 300, sessions: 1 } } },
      { project: null, name: "Tax return", lastTags: ["admin"] },
      {
        project: "Printer",
        name: "Mount printhead",
        firstStartedAt: "2026-10-15T10:00:00Z",
        lastStartedAt: "2026-10-15T11:00:00Z",
        lastTags: ["hw", "fix"],
        periods: { today: { seconds: 2400, sessions: 2 }, overall: { seconds: 2400, sessions: 2 } },
      },
      { project: "Printer", name: null, periods: { today: { seconds: 840, sessions: 1 } } },
    ]);
    const printer = again.projectId!;
    const s = state("2026-10-15", printer, "MOUNT printhead");
    expect(s.task).toMatchObject({
      projectId: printer,
      name: "Mount printhead",
      periods: { today: { seconds: 2400 } },
    });
    expect(s.project?.periods.today).toMatchObject({ seconds: 840 + 2400, sessions: 3 });
    // A task on its own: no project.
    expect(state("2026-10-15", undefined, "tax return")).toMatchObject({
      project: null,
      task: { projectId: null, name: "Tax return", periods: { today: { seconds: 2400, sessions: 1 } } },
    });
  });

  it("shows the running session's task", () => {
    at("2026-10-15T09:00");
    store.start("alice", { zone: UTC, project: "Printer", task: "Pull strings" });
    at("2026-10-15T09:40");
    expect(state("2026-10-15").task).toMatchObject({ name: "Pull strings", periods: { today: { seconds: 2400 } } });
  });

  it("renames a task, names the sessions without one, and moves tasks between projects", () => {
    session("2026-10-15T09:00", "2026-10-15T09:14", "Printer");
    const mount = session("2026-10-15T10:00", "2026-10-15T10:30", "Printer", [], "Mount printhead");
    session("2026-10-15T12:00", "2026-10-15T12:40", null, [], "Tax return");
    const printer = mount.projectId!;
    expect(
      store.updateTask("alice", { projectId: printer, name: "mount printhead", rename: "Mount the printhead" }),
    ).toEqual({ projectId: printer, name: "Mount the printhead" });
    // Only a new spelling of its own name.
    store.updateTask("alice", { projectId: printer, name: "Mount the printhead", rename: "mount the printhead" });
    store.updateTask("alice", { projectId: printer, name: null, rename: "Unbox" });
    const admin = store.updateTask("alice", { projectId: null, name: "Tax return", project: "Admin" }).projectId;
    // Into a task the project has already: the two are one.
    store.updateTask("alice", { projectId: printer, name: "Unbox", project: "admin", rename: "TAX RETURN" });
    expect(tasks().map((t) => [t.project, t.name, t.periods.overall])).toMatchObject([
      ["Admin", "Tax return", { seconds: 2400 + 840, sessions: 2 }],
      ["Printer", "mount the printhead", { seconds: 1800, sessions: 1 }],
    ]);
    expect(admin).not.toBe(printer);
    expect(refusal(() => store.updateTask("alice", { projectId: "nope", name: null })).status).toBe(404);
    expect(refusal(() => store.updateTask("bob", { projectId: printer, name: null })).status).toBe(404);
  });

  it("switches from the running session to another in one step", () => {
    at("2026-10-15T09:00");
    const first = store.start("alice", { zone: UTC, project: "Printer", task: "Mount chassis" });
    at("2026-10-15T09:30");
    // Without switch, Play answers the running session.
    expect(store.start("alice", { zone: UTC, task: "Phone call" }).id).toBe(first.id);
    const second = store.start("alice", { zone: UTC, task: "Phone call", tags: ["call"], switch: true });
    expect(second).toMatchObject({ project: null, task: "Phone call", tags: ["call"], endedAt: null });
    const s = state("2026-10-15");
    expect(s.running?.id).toBe(second.id);
    expect(s.last).toMatchObject({ id: first.id, endedAt: "2026-10-15T09:30:00Z", stop: "manual" });
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

  it("moves a session to the day of its new start", () => {
    const s = session("2026-10-15T23:00", "2026-10-16T02:00");
    expect(store.updateSession("alice", s.id, { startedAt: "2026-10-16T00:30:00Z" }).day).toBe("2026-10-16");
    expect(state("2026-10-15").all.today).toMatchObject({ seconds: 0, sessions: 0 });
    expect(state("2026-10-16").all.today).toMatchObject({ seconds: 5400, sessions: 1 });
  });

  it("deletes a session, the running one too", () => {
    const s = session("2026-10-15T09:00", "2026-10-15T10:00");
    store.start("alice", { zone: UTC });
    const running = state("2026-10-15").running!;
    store.deleteSession("alice", running.id);
    store.deleteSession("alice", s.id);
    expect(state("2026-10-15").all.overall).toMatchObject({ seconds: 0, sessions: 0 });
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

  it("lists a session past midnight on every day it has time in", () => {
    const night = session("2026-10-10T22:00", "2026-10-12T01:00");
    session("2026-10-14T09:00", "2026-10-14T10:00");
    at("2026-10-15T23:00");
    const running = store.start("alice", { zone: UTC });
    at("2026-10-16T00:30");
    const page = store.sessions("alice", {});
    expect(page.days).toEqual(["2026-10-16", "2026-10-15", "2026-10-14", "2026-10-12", "2026-10-11", "2026-10-10"]);
    expect(page.sessions.map((s) => s.id)).toEqual([running.id, expect.any(String), night.id]);
    // The page before the 12th still has the night's session, for the 10th and 11th.
    expect(store.sessions("alice", { before: "2026-10-12" })).toMatchObject({
      days: ["2026-10-11", "2026-10-10"],
      sessions: [{ id: night.id }],
      next: null,
    });
  });

  it("exports every session as CSV", () => {
    session("2026-10-15T09:00", "2026-10-15T10:30", '=Sum, "quoted"', ["code"]);
    expect(store.exportCsv("alice").split("\r\n")).toEqual([
      "day,start,end,zone,seconds,hours,project,task,tags,stop",
      `2026-10-15,2026-10-15 09:00:00,2026-10-15 10:30:00,UTC,5400,1.50,"'=Sum, ""quoted""",,code,manual`,
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
    expect(byName().get("Axis")!.periods.today).toMatchObject({ seconds: 5400, sessions: 2 });
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

it("keeps the sessions of Urd 1, and lets its running one run on", () => {
  const dir = mkdtempSync(join(tmpdir(), "urd-"));
  const file = join(dir, "urd.db");
  const s = (wall: string) => Date.parse(`${wall}:00Z`) / 1000;
  const old = openDatabase(file, 1);
  old
    .prepare(
      `INSERT INTO sessions (id, owner, started_at, ended_at, cutoff_at, zone, day, stop, created_at, updated_at)
       VALUES (?, 'alice', ?, ?, ?, 'UTC', ?, ?, '', '')`,
    )
    .run("late", s("2026-10-15T22:30"), s("2026-10-16T05:00"), s("2026-10-16T05:00"), "2026-10-15", "auto");
  old
    .prepare(
      `INSERT INTO sessions (id, owner, started_at, ended_at, cutoff_at, zone, day, stop, created_at, updated_at)
       VALUES (?, 'alice', ?, NULL, ?, 'UTC', ?, NULL, '', '')`,
    )
    .run("running", s("2026-10-16T09:00"), s("2026-10-17T00:00"), "2026-10-16");
  old.close();
  try {
    db = openDatabase(file);
    store = createStore(db, () => now);
    at("2026-10-17T09:00");
    const t = state("2026-10-16");
    expect(t.running).toMatchObject({ id: "running", seconds: 24 * 3600 });
    expect(t.last).toMatchObject({ id: "late", stop: "auto", seconds: 6.5 * 3600 });
    expect(t.all.today).toMatchObject({ seconds: 5 * 3600 + 15 * 3600, sessions: 2 });
    expect(store.sessions("alice", {}).days).toEqual(["2026-10-17", "2026-10-16", "2026-10-15"]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

it("deletes everything of users no longer in Heimdall", () => {
  session("2026-10-15T09:00", "2026-10-15T10:00", "Axis");
  at("2026-10-15T11:00");
  store.start("bob", { zone: UTC, project: "Bob's" });
  expect(store.removeUnknownOwners(new Set(["alice"]))).toEqual([{ owner: "bob", sessions: 1, projects: 1 }]);
  expect(store.state("bob", { today: "2026-10-15" }).all.overall.sessions).toBe(0);
  expect(state("2026-10-15").all.overall.sessions).toBe(1);
});
