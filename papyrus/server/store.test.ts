import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays } from "../shared/dates.ts";
import { parseQuery } from "../shared/query.ts";
import type { ExportFile, Journal } from "../shared/protocol.ts";
import { openDatabase } from "./db.ts";
import { StoreError, createStore, snippetOf, type Store } from "./store.ts";

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
let diary: Journal;

beforeEach(() => {
  db = openDatabase(":memory:");
  store = createStore(db);
  diary = store.createJournal("alice", { name: "Diary" });
});

/** Writes a page from scratch (or over whatever is there). */
function write(owner: string, journalId: string, date: string, text: string, mood: number | null = null) {
  const { rev } = store.getPage(owner, journalId, date);
  return store.putPage(owner, journalId, date, { text, mood, rev });
}

describe("journals", () => {
  it("keeps each user's journals apart", () => {
    const bobs = store.createJournal("bob", { name: "Diary" });
    expect(store.journals("alice").map((j) => j.id)).toEqual([diary.id]);
    expect(refusal(() => store.getPage("alice", bobs.id, "2026-10-12")).status).toBe(404);
    expect(refusal(() => store.updateJournal("alice", bobs.id, { name: "Mine" })).status).toBe(404);
    expect(refusal(() => store.deleteJournal("alice", bobs.id)).status).toBe(404);
    expect(refusal(() => write("alice", bobs.id, "2026-10-12", "hi")).status).toBe(404);
  });

  it("refuses a second journal with the same name, ignoring case", () => {
    const err = refusal(() => store.createJournal("alice", { name: " diary " }));
    expect([err.status, err.code]).toEqual([409, "exists"]);
    const work = store.createJournal("alice", { name: "Work" });
    expect(refusal(() => store.updateJournal("alice", work.id, { name: "DIARY" })).code).toBe("exists");
    expect(store.updateJournal("alice", work.id, { name: "work", color: "rose" })).toMatchObject({
      name: "work",
      color: "rose",
    });
  });

  it("gives new journals a colour no other has yet", () => {
    expect(diary.color).toBe("amber");
    expect(store.createJournal("alice", { name: "Work" }).color).toBe("rose");
    expect(refusal(() => store.createJournal("alice", { name: "X", color: "pink" })).code).toBe("invalid");
  });

  it("keeps the order it is given", () => {
    const work = store.createJournal("alice", { name: "Work" });
    const dreams = store.createJournal("alice", { name: "Dreams" });
    expect(store.orderJournals("alice", [dreams.id, diary.id, work.id]).map((j) => j.name)).toEqual([
      "Dreams",
      "Diary",
      "Work",
    ]);
    expect(refusal(() => store.orderJournals("alice", [dreams.id, diary.id])).code).toBe("invalid");
  });

  it("moves a journal and its pages to the bin, and back", () => {
    write("alice", diary.id, "2026-10-12", "a day #walk");
    const binned = store.deleteJournal("alice", diary.id);
    expect(binned.deletedAt).not.toBeNull();
    expect(refusal(() => store.getPage("alice", diary.id, "2026-10-12")).status).toBe(404);
    expect(store.days("alice", { from: "2026-10-01", to: "2026-10-31" })).toEqual([]);
    expect(store.search("alice", { q: "day" }).hits).toEqual([]);
    expect(store.tags("alice")).toEqual([]);
    // Its name is free again while it is in the bin, but then restoring it would clash.
    const other = store.createJournal("alice", { name: "diary" });
    expect(refusal(() => store.restoreJournal("alice", diary.id)).code).toBe("exists");
    store.updateJournal("alice", other.id, { name: "Other" });
    expect(store.restoreJournal("alice", diary.id).deletedAt).toBeNull();
    expect(store.getPage("alice", diary.id, "2026-10-12").text).toBe("a day #walk");
  });

  it("deletes for good only from the bin, pages included", () => {
    write("alice", diary.id, "2026-10-12", "gone soon #x");
    expect(refusal(() => store.purgeJournal("alice", diary.id)).code).toBe("not-in-bin");
    store.deleteJournal("alice", diary.id);
    store.purgeJournal("alice", diary.id);
    expect(store.journals("alice")).toEqual([]);
    expect(db.prepare("SELECT count(*) AS n FROM pages").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT count(*) AS n FROM page_tags").get()).toEqual({ n: 0 });
  });

  it("empties the bin after 30 days", () => {
    store.deleteJournal("alice", diary.id);
    expect(store.purge(Date.now() + 29 * 86_400_000)).toBe(0);
    expect(store.purge(Date.now() + 31 * 86_400_000)).toBe(1);
    expect(store.journals("alice")).toEqual([]);
  });
});

describe("pages", () => {
  it("answers an empty page for a day without one", () => {
    expect(store.getPage("alice", diary.id, "2026-10-12")).toEqual({
      journalId: diary.id,
      date: "2026-10-12",
      text: "",
      mood: null,
      tags: [],
      words: 0,
      rev: 0,
      updatedAt: null,
    });
  });

  it("creates, updates and reads a page", () => {
    const first = store.putPage("alice", diary.id, "2026-10-12", { text: "Rain all day. #weather", mood: 2, rev: 0 });
    expect(first).toMatchObject({ words: 4, tags: ["weather"] });
    expect(first.rev).toBeGreaterThan(0);
    const second = store.putPage("alice", diary.id, "2026-10-12", { text: "Sun later.", mood: 4, rev: first.rev });
    expect(second.rev).toBeGreaterThan(first.rev);
    expect(store.getPage("alice", diary.id, "2026-10-12")).toMatchObject({
      text: "Sun later.",
      mood: 4,
      tags: [],
      words: 2,
      rev: second.rev,
    });
  });

  it("refuses a save made from an older version", () => {
    const first = write("alice", diary.id, "2026-10-12", "one");
    write("alice", diary.id, "2026-10-12", "two");
    const err = refusal(() =>
      store.putPage("alice", diary.id, "2026-10-12", { text: "mine", mood: null, rev: first.rev }),
    );
    expect([err.status, err.code]).toEqual([409, "conflict"]);
    expect(err.page).toMatchObject({ text: "two" });
    // Expecting no page where there is one is a conflict too.
    expect(refusal(() => store.putPage("alice", diary.id, "2026-10-12", { text: "x", mood: null, rev: 0 })).code).toBe(
      "conflict",
    );
  });

  it("accepts what is already stored, whatever rev comes with it", () => {
    const saved = write("alice", diary.id, "2026-10-12", "same", 3);
    expect(store.putPage("alice", diary.id, "2026-10-12", { text: "same", mood: 3, rev: 12345 })).toEqual(saved);
    expect(store.putPage("alice", diary.id, "2026-10-13", { text: "  ", mood: null, rev: 99 })).toMatchObject({
      rev: 0,
    });
  });

  it("deletes a page that becomes empty, and never reuses its rev", () => {
    const first = write("alice", diary.id, "2026-10-12", "short-lived");
    expect(store.putPage("alice", diary.id, "2026-10-12", { text: " \n", mood: null, rev: first.rev })).toMatchObject({
      rev: 0,
    });
    expect(db.prepare("SELECT count(*) AS n FROM pages").get()).toEqual({ n: 0 });
    const again = store.putPage("alice", diary.id, "2026-10-12", { text: "back", mood: null, rev: 0 });
    expect(again.rev).not.toBe(first.rev);
    // A tab still holding the first version can't overwrite the new page.
    expect(
      refusal(() => store.putPage("alice", diary.id, "2026-10-12", { text: "stale", mood: null, rev: first.rev })).code,
    ).toBe("conflict");
  });

  it("keeps a page with only a mood", () => {
    expect(store.putPage("alice", diary.id, "2026-10-12", { text: "", mood: 5, rev: 0 }).rev).toBeGreaterThan(0);
    expect(store.days("alice", { from: "2026-10-12", to: "2026-10-12" })).toMatchObject([{ mood: 5, words: 0 }]);
  });

  it("checks what it is sent", () => {
    const put = (body: unknown, date = "2026-10-12") =>
      refusal(() => store.putPage("alice", diary.id, date, body)).code;
    expect(put({ text: "x", mood: null, rev: 0 }, "2026-02-30")).toBe("invalid");
    expect(put({ text: 1, mood: null, rev: 0 })).toBe("invalid");
    expect(put({ text: "x", mood: 6, rev: 0 })).toBe("invalid");
    expect(put({ text: "x", mood: null })).toBe("invalid");
    expect(put({ text: "x".repeat(200_001), mood: null, rev: 0 })).toBe("invalid");
  });

  it("refuses days that haven't come yet, wherever today is", () => {
    const utcToday = new Date().toISOString().slice(0, 10);
    // Tomorrow in UTC is already today east of it.
    expect(write("alice", diary.id, addDays(utcToday, 1), "early in Auckland").rev).toBeGreaterThan(0);
    expect(refusal(() => write("alice", diary.id, addDays(utcToday, 2), "too soon")).code).toBe("invalid");
    expect(refusal(() => write("alice", diary.id, "2999-01-01", "far off")).code).toBe("invalid");
  });
});

describe("days, on this day, streak and tags", () => {
  beforeEach(() => {
    write("alice", diary.id, "2024-02-29", "leap #Travel/Japan", 5);
    write("alice", diary.id, "2025-10-12", "a year ago #travel", 4);
    write("alice", diary.id, "2026-10-10", "two days ago");
    write("alice", diary.id, "2026-10-11", "yesterday #work");
    const work = store.createJournal("alice", { name: "Work" });
    write("alice", work.id, "2026-10-09", "work log #work");
  });

  it("lists the days of a range without their text", () => {
    const days = store.days("alice", { from: "2026-10-01", to: "2026-10-31" });
    expect(days.map((d) => d.date)).toEqual(["2026-10-09", "2026-10-10", "2026-10-11"]);
    expect(days[2]).toEqual({
      journalId: diary.id,
      date: "2026-10-11",
      mood: null,
      words: 2,
      tags: ["work"],
      preview: "yesterday #work",
    });
    expect(store.days("alice", { from: "2026-10-01", to: "2026-10-31", journal: diary.id })).toHaveLength(2);
    expect(refusal(() => store.days("alice", { from: "2026-10-31", to: "2026-10-01" })).code).toBe("invalid");
    expect(refusal(() => store.days("alice", { from: "2025-01-01", to: "2026-12-31" })).code).toBe("invalid");
  });

  it("finds the same day in earlier years", () => {
    expect(store.onThisDay("alice", { date: "2026-10-12" }).map((d) => d.date)).toEqual(["2025-10-12"]);
    expect(store.onThisDay("alice", { date: "2027-02-28" }).map((d) => d.date)).toEqual(["2024-02-29"]);
    expect(store.onThisDay("alice", { date: "2028-02-28" })).toEqual([]);
  });

  it("counts the days in a row up to today or yesterday", () => {
    expect(store.streak("alice", { today: "2026-10-12" })).toEqual({ days: 3 });
    expect(store.streak("alice", { today: "2026-10-11" })).toEqual({ days: 3 });
    expect(store.streak("alice", { today: "2026-10-12", journal: diary.id })).toEqual({ days: 2 });
    expect(store.streak("alice", { today: "2026-10-14" })).toEqual({ days: 0 });
  });

  it("counts tags", () => {
    expect(store.tags("alice")).toEqual([
      { tag: "travel", count: 1 },
      { tag: "travel/japan", count: 1 },
      { tag: "work", count: 2 },
    ]);
    expect(store.tags("bob")).toEqual([]);
  });
});

describe("search", () => {
  beforeEach(() => {
    write("alice", diary.id, "2026-01-05", "Coffee at the Café Lumière with Ana. #friends", 5);
    write("alice", diary.id, "2026-03-10", "A long walk. #walk_long", 3);
    write("alice", diary.id, "2026-06-20", "Work all day #work/q2, then a walk", 2);
    write("alice", diary.id, "2026-09-01", "Quiet day.");
  });
  const dates = (q: string) => store.search("alice", { q }).hits.map((h) => h.date);

  it("matches words without case or accents, newest first", () => {
    expect(dates("cafe lumiere")).toEqual(["2026-01-05"]);
    expect(dates("CAFÉ")).toEqual(["2026-01-05"]);
    expect(dates("walk")).toEqual(["2026-06-20", "2026-03-10"]);
    expect(dates("da")).toEqual(["2026-09-01", "2026-06-20"]);
  });

  it("matches phrases, exclusions, tags, moods and dates", () => {
    expect(dates('"long walk"')).toEqual(["2026-03-10"]);
    expect(dates("walk -work")).toEqual(["2026-03-10"]);
    expect(dates("#work")).toEqual(["2026-06-20"]);
    expect(dates("#walk")).toEqual([]);
    expect(dates("#walk_long")).toEqual(["2026-03-10"]);
    expect(dates("mood:>=3")).toEqual(["2026-03-10", "2026-01-05"]);
    expect(dates("-mood:5")).toEqual(["2026-09-01", "2026-06-20", "2026-03-10"]);
    expect(dates("day before:2026-09-01")).toEqual(["2026-06-20"]);
    expect(dates("after:2026-06-20")).toEqual(["2026-09-01"]);
  });

  it("finds nothing for an empty search, and only the user's own pages", () => {
    expect(dates("  ")).toEqual([]);
    const bobs = store.createJournal("bob", { name: "B" });
    write("bob", bobs.id, "2026-01-01", "coffee too");
    expect(dates("coffee")).toEqual(["2026-01-05"]);
  });

  it("says when there were more results than it shows", () => {
    for (let i = 0; i < 201; i++) write("alice", diary.id, addDays("2020-01-01", i), "many");
    const answer = store.search("alice", { q: "many" });
    expect(answer.hits).toHaveLength(200);
    expect(answer.more).toBe(true);
  });

  it("marks the matches in the snippet, accents included", () => {
    const { snippet, marks } = snippetOf("Coffee at the Café Lumière", parseQuery("cafe lumiere"));
    expect(marks.map(([a, b]) => snippet.slice(a, b))).toEqual(["Café", "Lumière"]);
    const long = `${"word ".repeat(40)}the needle is here ${"more ".repeat(60)}`;
    const cut = snippetOf(long, parseQuery("needle"));
    expect(cut.snippet.startsWith("…")).toBe(true);
    expect(cut.snippet.endsWith("…")).toBe(true);
    expect(cut.marks.map(([a, b]) => cut.snippet.slice(a, b))).toEqual(["needle"]);
  });
});

describe("templates and settings", () => {
  it("creates, changes and deletes templates; journals forget a deleted one", () => {
    const t = store.createTemplate("alice", { name: "Gratitude", text: "Three things:\n1.\n2.\n3." });
    store.updateJournal("alice", diary.id, { templateId: t.id });
    expect(store.updateTemplate("alice", t.id, { name: "Thanks" }).name).toBe("Thanks");
    expect(refusal(() => store.updateTemplate("bob", t.id, { name: "x" })).status).toBe(404);
    expect(refusal(() => store.updateJournal("alice", diary.id, { templateId: "nope" })).code).toBe("invalid");
    store.deleteTemplate("alice", t.id);
    expect(store.templates("alice")).toEqual([]);
    expect(store.journals("alice")[0]!.templateId).toBeNull();
  });

  it("keeps settings, and turns an empty prompt list into the built-in one", () => {
    expect(store.settings("alice")).toEqual({ prompts: null, weekStart: null });
    expect(store.putSettings("alice", { prompts: [" One ", "", "Two"], weekStart: 0 })).toEqual({
      prompts: ["One", "Two"],
      weekStart: 0,
    });
    expect(store.settings("alice")).toEqual({ prompts: ["One", "Two"], weekStart: 0 });
    expect(store.putSettings("alice", { prompts: [], weekStart: null })).toEqual({ prompts: null, weekStart: null });
    expect(refusal(() => store.putSettings("alice", { weekStart: 3 })).code).toBe("invalid");
    expect(refusal(() => store.putSettings("alice", { prompts: "x" })).code).toBe("invalid");
  });
});

describe("removed users", () => {
  it("deletes everything of owners Heimdall no longer has", () => {
    write("alice", diary.id, "2026-10-12", "mine #a");
    const bobs = store.createJournal("bob", { name: "B" });
    write("bob", bobs.id, "2026-10-12", "bob's #b");
    store.createTemplate("bob", { name: "T", text: "" });
    store.putSettings("bob", { prompts: ["x"], weekStart: 1 });
    expect(store.removeUnknownOwners(new Set(["alice"]))).toEqual([{ owner: "bob", journals: 1, pages: 1 }]);
    expect(store.journals("bob")).toEqual([]);
    expect(store.templates("bob")).toEqual([]);
    expect(store.settings("bob")).toEqual({ prompts: null, weekStart: null });
    expect(store.tags("alice")).toEqual([{ tag: "a", count: 1 }]);
    expect(store.removeUnknownOwners(new Set(["alice"]))).toEqual([]);
  });
});

describe("export and import", () => {
  beforeEach(() => {
    const t = store.createTemplate("alice", { name: "Evening", text: "Best part of today:" });
    store.updateJournal("alice", diary.id, { templateId: t.id });
    write("alice", diary.id, "2026-10-11", "Saturday. #weekend", 4);
    write("alice", diary.id, "2026-10-12", "Sunday.");
    const dreams = store.createJournal("alice", { name: "Dreams", color: "violet" });
    write("alice", dreams.id, "2026-10-12", "Flying again.");
    store.createJournal("alice", { name: "Binned" });
    store.deleteJournal("alice", store.journals("alice").find((j) => j.name === "Binned")!.id);
    store.putSettings("alice", { prompts: ["What surprised you?"], weekStart: 1 });
  });

  it("round-trips into another user's empty account", () => {
    const file = store.exportAll("alice");
    expect(file.journals.map((j) => j.name)).toEqual(["Diary", "Dreams"]);
    expect(store.importAll("bob", file)).toEqual({ journals: 2, templates: 1, pages: 3, merged: 0, skipped: 0 });
    const again = store.exportAll("bob");
    expect({ ...again, exportedAt: "" }).toEqual({ ...file, exportedAt: "" });
  });

  it("changes nothing the second time", () => {
    const file = store.exportAll("alice");
    expect(store.importAll("alice", file)).toEqual({ journals: 0, templates: 0, pages: 0, merged: 0, skipped: 3 });
    expect(store.exportAll("alice").journals).toEqual(file.journals);
  });

  it("merges into pages that are already there", () => {
    const file = store.exportAll("alice");
    const diaryPages = file.journals[0]!.pages;
    diaryPages[0] = { ...diaryPages[0]!, text: "Saturday. #weekend Then a film." }; // holds the page: replaces it
    diaryPages[1] = { ...diaryPages[1]!, text: "Also: a phone call.", mood: 3 }; // different: added after it
    diaryPages.push({ ...diaryPages[1]!, date: "2026-10-01", text: "New day." });
    expect(store.importAll("alice", file)).toEqual({ journals: 0, templates: 0, pages: 1, merged: 2, skipped: 1 });
    expect(store.getPage("alice", diary.id, "2026-10-11")).toMatchObject({
      text: "Saturday. #weekend Then a film.",
      mood: 4,
    });
    expect(store.getPage("alice", diary.id, "2026-10-12")).toMatchObject({
      text: "Sunday.\n\nAlso: a phone call.",
      mood: 3,
    });
    expect(store.importAll("alice", file)).toMatchObject({ pages: 0, merged: 0 });
  });

  it("writes nothing from a bad file", () => {
    const file = store.exportAll("alice") as ExportFile & { journals: unknown[] };
    file.journals.push({ name: "Broken", color: "amber", template: null, pages: [{ date: "2026-02-30", text: "x" }] });
    const err = refusal(() => store.importAll("bob", file));
    expect(err.message).toMatch(/Journal 3: Page 1: The date/);
    expect(store.journals("bob")).toEqual([]);
    expect(store.templates("bob")).toEqual([]);
    expect(refusal(() => store.importAll("bob", { format: "janus", version: 1 })).code).toBe("invalid");
  });

  it("keeps the user's own settings", () => {
    store.putSettings("bob", { prompts: ["Mine"], weekStart: null });
    store.importAll("bob", store.exportAll("alice"));
    expect(store.settings("bob")).toEqual({ prompts: ["Mine"], weekStart: 1 });
  });
});
