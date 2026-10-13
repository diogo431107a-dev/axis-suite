import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { ImportEvent } from "../shared/protocol.ts";
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

let db: DatabaseSync;
let store: Store;
let cal: string;

beforeEach(() => {
  db = openDatabase(":memory:");
  store = createStore(db);
  cal = store.createCalendar("odin", { name: "Personal" }).id;
});

const timed = (over: Record<string, unknown> = {}) => ({
  calendarId: cal,
  title: "Lunch",
  allDay: false,
  start: "2026-11-08T15:00:00Z",
  end: "2026-11-08T16:00:00Z",
  location: "",
  description: "",
  url: "",
  ...over,
});

const imported = (uid: string, over: Partial<ImportEvent> = {}): ImportEvent => ({
  uid,
  recurrenceId: "",
  title: uid,
  allDay: true,
  start: "2026-10-24",
  end: "2026-10-25",
  sourceZone: null,
  location: "",
  description: "",
  url: "",
  ...over,
});

describe("calendars", () => {
  it("keeps names unique per owner, ignoring case, and gives new ones a free colour", () => {
    expect(refusal(() => store.createCalendar("odin", { name: "personal" })).code).toBe("exists");
    const other = store.createCalendar("freya", { name: "Personal" });
    expect(other.color).toBe("indigo");
    expect(store.createCalendar("odin", { name: "F1" }).color).toBe("sky");
    expect(store.calendars("odin").map((c) => c.name)).toEqual(["Personal", "F1"]);
  });

  it("hides, renames and deletes with its events", () => {
    store.createEvent("odin", timed());
    expect(store.updateCalendar("odin", cal, { visible: false })).toMatchObject({ visible: false, events: 1 });
    expect(store.updateCalendar("odin", cal, { name: "Me" }).name).toBe("Me");
    expect(refusal(() => store.updateCalendar("freya", cal, { name: "Mine" })).status).toBe(404);
    store.deleteCalendar("odin", cal);
    expect((db.prepare("SELECT count(*) AS n FROM events").get() as { n: number }).n).toBe(0);
  });
});

describe("events", () => {
  it("checks what it is given", () => {
    expect(refusal(() => store.createEvent("odin", timed({ title: " " }))).message).toMatch(/title/);
    expect(refusal(() => store.createEvent("odin", timed({ start: "2026-11-08 15:00" }))).code).toBe("invalid");
    expect(refusal(() => store.createEvent("odin", timed({ end: "2026-11-08T14:00:00Z" }))).message).toMatch(/before/);
    expect(refusal(() => store.createEvent("odin", timed({ allDay: true }))).code).toBe("invalid");
    const day = { allDay: true, start: "2026-11-08", end: "2026-11-08" };
    expect(refusal(() => store.createEvent("odin", timed(day))).code).toBe("invalid");
    expect(refusal(() => store.createEvent("odin", timed({ url: "javascript:alert(1)" }))).code).toBe("invalid");
    expect(refusal(() => store.createEvent("freya", timed())).status).toBe(404);
    expect(store.event("odin", store.createEvent("odin", timed({ url: "example.com" })).id).url).toBe(
      "https://example.com",
    );
  });

  it("stores timed and all-day events apart", () => {
    const a = store.createEvent("odin", timed());
    const b = store.createEvent("odin", timed({ allDay: true, start: "2026-11-08", end: "2026-11-09" }));
    expect(store.event("odin", a.id)).toMatchObject({ allDay: false, start: "2026-11-08T15:00:00Z", origin: "user" });
    expect(store.event("odin", b.id)).toMatchObject({ allDay: true, start: "2026-11-08", end: "2026-11-09" });
    expect(store.event("odin", a.id).uid).toMatch(/@chronos$/);
    expect(refusal(() => store.event("freya", a.id)).status).toBe(404);
  });

  it("finds the events of days in the home zone", () => {
    store.putSettings("odin", { homeZone: "America/Sao_Paulo" });
    // 22:30–23:30 on the 8th in Sao Paulo, the 9th in UTC.
    store.createEvent("odin", timed({ title: "Late", start: "2026-11-09T01:30:00Z", end: "2026-11-09T02:30:00Z" }));
    store.createEvent("odin", timed({ title: "Point", start: "2026-11-09T03:00:00Z", end: "2026-11-09T03:00:00Z" }));
    store.createEvent("odin", timed({ title: "Days", allDay: true, start: "2026-11-07", end: "2026-11-09" }));
    const titles = (from: string, to: string) => store.events("odin", { from, to }).map((e) => e.title);
    expect(titles("2026-11-08", "2026-11-09")).toEqual(["Days", "Late"]);
    expect(titles("2026-11-09", "2026-11-10")).toEqual(["Point"]);
    expect(titles("2026-11-01", "2026-12-01")).toHaveLength(3);
    expect(store.events("freya", { from: "2026-11-01", to: "2026-12-01" })).toEqual([]);
    expect(refusal(() => store.events("odin", { from: "2026-11-01", to: "2029-12-01" })).code).toBe("invalid");
  });

  it("refuses a save made from an old revision", () => {
    const { id, rev } = store.createEvent("odin", timed());
    const saved = store.putEvent("odin", id, { ...timed({ title: "Dinner" }), rev });
    const err = refusal(() => store.putEvent("odin", id, { ...timed({ title: "Brunch" }), rev }));
    expect(err.code).toBe("conflict");
    expect(err.event).toMatchObject({ title: "Dinner", rev: saved.rev });
  });

  it("moves an event to another calendar, and deletes it", () => {
    const other = store.createCalendar("odin", { name: "Work" }).id;
    const { id, rev } = store.createEvent("odin", timed());
    store.putEvent("odin", id, { ...timed({ calendarId: other }), rev });
    expect(store.event("odin", id).calendarId).toBe(other);
    expect(refusal(() => store.deleteEvent("freya", id)).status).toBe(404);
    store.deleteEvent("odin", id);
    expect(refusal(() => store.event("odin", id)).status).toBe(404);
  });
});

describe("settings", () => {
  it("checks the zone and the default calendar", () => {
    expect(store.settings("odin")).toEqual({ homeZone: "", defaultCalendarId: null, defaultDuration: 60 });
    expect(store.putSettings("odin", { homeZone: "america/sao_paulo" }).homeZone).toBe("America/Sao_Paulo");
    expect(refusal(() => store.putSettings("odin", { homeZone: "Mars/Base" })).code).toBe("invalid");
    expect(refusal(() => store.putSettings("odin", { homeZone: "UTC+03:00" })).code).toBe("invalid");
    expect(refusal(() => store.putSettings("freya", { defaultCalendarId: cal })).status).toBe(404);
  });
});

describe("import", () => {
  const moon = [imported("full"), imported("new", { start: "2026-11-09", end: "2026-11-10" })];

  it("adds a file to a new calendar, and a second time changes nothing", () => {
    const first = store.importEvents("odin", { newCalendar: { name: "Moon" }, sourceName: "moon.ics", events: moon });
    expect(first).toMatchObject({ added: 2, updated: 0, unchanged: 0, removed: 0 });
    expect(store.calendars("odin").find((c) => c.id === first.calendarId)).toMatchObject({
      name: "Moon",
      sourceName: "moon.ics",
      events: 2,
    });
    const again = store.importEvents("odin", { calendarId: first.calendarId, sourceName: "moon.ics", events: moon });
    expect(again).toMatchObject({ added: 0, updated: 0, unchanged: 2 });
    // A new calendar with a name already taken gets another.
    const third = store.importEvents("odin", { newCalendar: { name: "moon" }, sourceName: "", events: moon });
    expect(store.calendars("odin").find((c) => c.id === third.calendarId)!.name).toBe("moon (2)");
  });

  it("updates what changed and, when asked, removes what the file no longer has, sparing events made here", () => {
    const { calendarId } = store.importEvents("odin", { calendarId: cal, sourceName: "", events: moon });
    store.createEvent("odin", timed());
    const changed = [imported("full", { title: "Full moon 🌕" })];
    const r = store.importEvents("odin", { calendarId, sourceName: "", removeMissing: true, events: changed });
    expect(r).toMatchObject({ added: 0, updated: 1, unchanged: 0, removed: 1 });
    expect(
      store
        .calendarEvents("odin", calendarId)
        .map((e) => e.title)
        .sort(),
    ).toEqual(["Full moon 🌕", "Lunch"]);
  });

  it("matches occurrences by UID and recurrence id", () => {
    const series = ["2026-01-01", "2027-01-01"].map((d) =>
      imported("new-year", { recurrenceId: d, start: d, end: d.replace("-01-01", "-01-02") }),
    );
    expect(store.importEvents("odin", { calendarId: cal, sourceName: "", events: series }).added).toBe(2);
    expect(store.importEvents("odin", { calendarId: cal, sourceName: "", events: series }).unchanged).toBe(2);
  });

  it("writes nothing from a bad file", () => {
    const bad = [...moon, imported("bad", { start: "2026-10-24", end: "2026-10-24" })];
    const err = refusal(() => store.importEvents("odin", { calendarId: cal, sourceName: "", events: bad }));
    expect(err.message).toMatch(/^Event 3:/);
    expect(store.calendarEvents("odin", cal)).toEqual([]);
    expect(refusal(() => store.importEvents("freya", { calendarId: cal, sourceName: "", events: moon })).status).toBe(
      404,
    );
  });

  it("keeps the source zone of timed events", () => {
    const f1 = imported("race", {
      allDay: false,
      start: "2026-11-08T17:00:00Z",
      end: "2026-11-08T19:00:00Z",
      sourceZone: "UTC",
    });
    store.importEvents("odin", { calendarId: cal, sourceName: "", events: [f1] });
    const [e] = store.calendarEvents("odin", cal);
    expect(e).toMatchObject({ sourceZone: "UTC", origin: "import" });
    // Changing its times here drops the file's zone.
    store.putEvent("odin", e!.id, {
      ...timed({ start: "2026-11-08T18:00:00Z", end: "2026-11-08T20:00:00Z" }),
      rev: e!.rev,
    });
    expect(store.event("odin", e!.id).sourceZone).toBeNull();
  });
});

describe("backup", () => {
  it("restores for another user, and again changes nothing", () => {
    store.createEvent("odin", timed());
    store.importEvents("odin", { newCalendar: { name: "Moon" }, sourceName: "", events: [imported("full")] });
    store.putSettings("odin", { homeZone: "Europe/London", defaultCalendarId: cal });
    const file = JSON.parse(JSON.stringify(store.exportAll("odin")));
    expect(store.restore("freya", file)).toEqual({ calendars: 2, added: 2, updated: 0, unchanged: 0 });
    expect(store.restore("freya", file)).toEqual({ calendars: 0, added: 0, updated: 0, unchanged: 2 });
    expect(store.calendars("freya").map((c) => c.name)).toEqual(["Personal", "Moon"]);
    expect(store.settings("freya")).toMatchObject({ homeZone: "Europe/London", defaultCalendarId: null });
    const personal = store.calendars("freya")[0]!.id;
    expect(store.calendarEvents("freya", personal)[0]!.origin).toBe("user");
    expect(refusal(() => store.restore("freya", { format: "vinr", version: 1 })).code).toBe("invalid");
  });
});

describe("removed users", () => {
  it("deletes everything of owners Heimdall no longer has", () => {
    store.createEvent("odin", timed());
    store.createCalendar("loki", { name: "Mischief" });
    store.putSettings("loki", { homeZone: "UTC" });
    expect(store.removeUnknownOwners(new Set(["odin"]))).toEqual([{ owner: "loki", events: 0 }]);
    expect(store.calendars("loki")).toEqual([]);
    expect(store.calendars("odin")).toHaveLength(1);
  });
});

describe("sharing", () => {
  const users = new Set(["odin", "freya", "thor", "loki"]);
  const share = (shares: { username: string; permission: string }[], id = cal) =>
    store.setShares("odin", id, shares, users);
  const freyas = () => store.calendars("freya").find((c) => c.id === cal);
  const range = { from: "2026-11-01", to: "2026-12-01" };

  it("shows a calendar and its events to those it is shared with, and only to them", () => {
    const { id } = store.createEvent("odin", timed());
    expect(share([{ username: "freya", permission: "read" }])).toEqual([{ username: "freya", permission: "read" }]);
    expect(freyas()).toMatchObject({ owner: "odin", role: "viewer", shared: true, name: "Personal", events: 1 });
    expect(freyas()!.shares).toBeUndefined();
    expect(store.calendars("odin")[0]).toMatchObject({ role: "owner", shared: true, shares: [{ username: "freya" }] });
    expect(store.events("freya", range).map((e) => e.id)).toEqual([id]);
    expect(store.event("freya", id).title).toBe("Lunch");
    expect(store.calendarEvents("freya", cal)).toHaveLength(1);
    expect(store.calendars("thor")).toEqual([]);
    expect(store.events("thor", range)).toEqual([]);
    expect(refusal(() => store.event("thor", id)).status).toBe(404);
    expect(refusal(() => store.calendarEvents("thor", cal)).status).toBe(404);
  });

  it("lets a reader read, and nothing else", () => {
    const { id, rev } = store.createEvent("odin", timed());
    share([{ username: "freya", permission: "read" }]);
    expect(refusal(() => store.createEvent("freya", timed())).status).toBe(403);
    expect(refusal(() => store.putEvent("freya", id, timed({ rev, title: "Mine" }))).code).toBe("forbidden");
    expect(refusal(() => store.deleteEvent("freya", id)).status).toBe(403);
    expect(
      refusal(() => store.importEvents("freya", { calendarId: cal, sourceName: "", events: [imported("x")] })).status,
    ).toBe(403);
    expect(refusal(() => store.putSettings("freya", { defaultCalendarId: cal })).status).toBe(403);
    expect(store.event("odin", id).title).toBe("Lunch");
  });

  it("lets an editor change the events, which stay the owner's", () => {
    share([{ username: "freya", permission: "write" }]);
    expect(freyas()!.role).toBe("editor");
    const { id, rev } = store.createEvent("freya", timed({ title: "Dinner" }));
    const saved = store.putEvent("freya", id, timed({ rev, title: "Supper" }));
    expect(store.event("odin", id)).toMatchObject({ title: "Supper", rev: saved.rev });
    expect(db.prepare("SELECT owner FROM events WHERE id = ?").get(id)).toEqual({ owner: "odin" });
    // Two people editing the same event: the later save from an old revision is refused.
    expect(refusal(() => store.putEvent("odin", id, timed({ rev, title: "Late" }))).code).toBe("conflict");
    expect(store.importEvents("freya", { calendarId: cal, sourceName: "", events: [imported("x")] }).added).toBe(1);
    store.putSettings("freya", { defaultCalendarId: cal });
    store.deleteEvent("freya", id);
    expect(refusal(() => store.event("odin", id)).status).toBe(404);
  });

  it("leaves the calendar itself and who sees it to its owner", () => {
    share([{ username: "freya", permission: "write" }]);
    expect(refusal(() => store.updateCalendar("freya", cal, { name: "Ours" })).status).toBe(403);
    expect(refusal(() => store.deleteCalendar("freya", cal)).status).toBe(403);
    expect(refusal(() => store.setShares("freya", cal, [], users)).status).toBe(403);
    expect(refusal(() => store.removeShare("freya", cal, "thor")).status).toBe(403);
    expect(refusal(() => store.updateCalendar("thor", cal, { name: "Ours" })).status).toBe(404);
    store.updateCalendar("odin", cal, { name: "Family" });
    expect(freyas()!.name).toBe("Family");
  });

  it("checks the share list", () => {
    expect(refusal(() => share([{ username: "odin", permission: "read" }])).code).toBe("invalid");
    expect(refusal(() => share([{ username: "nobody", permission: "read" }])).code).toBe("invalid");
    expect(refusal(() => share([{ username: "freya", permission: "admin" }])).code).toBe("invalid");
    const twice = [
      { username: "freya", permission: "read" },
      { username: "freya", permission: "write" },
    ];
    expect(refusal(() => share(twice)).code).toBe("invalid");
    expect(refusal(() => store.setShares("odin", cal, [], null)).code).toBe("invalid");
    expect(store.calendars("odin")[0]!.shared).toBe(false);
  });

  it("gives each person their own colour and visibility, kept when the list is saved again", () => {
    store.createCalendar("freya", { name: "Mine", color: "indigo" });
    share([{ username: "freya", permission: "read" }]);
    expect(freyas()).toMatchObject({ color: "sky", visible: true });
    store.updateCalendar("freya", cal, { name: "Personal", color: "rose", visible: false });
    expect(freyas()).toMatchObject({ color: "rose", visible: false });
    expect(store.calendars("odin")[0]).toMatchObject({ color: "indigo", visible: true });
    share([
      { username: "freya", permission: "write" },
      { username: "thor", permission: "read" },
    ]);
    expect(freyas()).toMatchObject({ color: "rose", visible: false, role: "editor" });
    share([{ username: "thor", permission: "read" }]);
    expect(freyas()).toBeUndefined();
  });

  it("lets someone take a shared calendar off their list", () => {
    share([
      { username: "freya", permission: "read" },
      { username: "thor", permission: "read" },
    ]);
    store.removeShare("freya", cal, "freya");
    expect(freyas()).toBeUndefined();
    expect(refusal(() => store.removeShare("freya", cal, "freya")).status).toBe(404);
    store.removeShare("odin", cal, "thor");
    expect(store.calendars("odin")[0]!.shared).toBe(false);
  });

  it("moves an event only between calendars the user can change", () => {
    const theirs = store.createCalendar("freya", { name: "Freya's" }).id;
    store.setShares("freya", theirs, [{ username: "odin", permission: "read" }], users);
    const { id, rev } = store.createEvent("odin", timed());
    expect(refusal(() => store.putEvent("odin", id, timed({ rev, calendarId: theirs }))).status).toBe(403);
    store.setShares("freya", theirs, [{ username: "odin", permission: "write" }], users);
    store.putEvent("odin", id, timed({ rev, calendarId: theirs }));
    expect(db.prepare("SELECT owner FROM events WHERE id = ?").get(id)).toEqual({ owner: "freya" });
  });

  it("keeps shared calendars out of the backup, and drops shares with removed users", () => {
    share([{ username: "freya", permission: "read" }]);
    store.createCalendar("freya", { name: "Personal" });
    expect(store.exportAll("freya").calendars.map((c) => c.name)).toEqual(["Personal"]);
    expect(store.calendars("freya").map((c) => c.owner)).toEqual(["freya", "odin"]);
    store.removeUnknownOwners(new Set(["odin"]));
    expect(store.calendars("odin")[0]!.shared).toBe(false);
  });
});
