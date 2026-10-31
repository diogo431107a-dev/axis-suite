import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { Stamp } from "../shared/protocol.ts";
import { openDatabase } from "./db.ts";
import { createStore, type Store } from "./dossier.ts";
import { StoreError } from "./errors.ts";

const ME = "odin";
const OTHER = "freya";
const DAY: Stamp = { d: "2026-10-05", t: "14:30", p: "date" };

let db: DatabaseSync;
let store: Store;
let nextId = 0;
const id = () => `id-00000-${++nextId}`;

function fields(body = "Runs on Sundays.", src = "U") {
  return {
    told: DAY,
    hap: DAY,
    place: null,
    setting: null,
    src,
    wording: "para",
    body,
    cat: null,
    cert: "sure",
    conf: false,
    present: [],
    ctx: "",
    fu: null,
    contra: null,
    credit: false,
    incident: null,
  };
}

function openFile(name: string, owner = ME): string {
  const fileId = id();
  store.openFile(owner, {
    id: fileId,
    name,
    role: "",
    opened: "2026-10-05",
    entry: { ...fields("We met.", "O"), id: id(), incomplete: false },
  });
  return fileId;
}

function addEntry(person: string, over: Record<string, unknown> = {}, owner = ME): string {
  const entryId = id();
  store.addEntry(owner, { ...fields(), amends: null, incomplete: false, ...over, id: entryId, person });
  return entryId;
}

const refused = (fn: () => void, status: number, message?: RegExp) => {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(StoreError);
  expect((caught as StoreError).status).toBe(status);
  if (message) expect((caught as StoreError).message).toMatch(message);
};

beforeEach(() => {
  db = openDatabase(":memory:");
  store = createStore(db);
});

describe("care notes", () => {
  const add = (person: string, over: Record<string, unknown> = {}, owner = ME) => {
    const noteId = id();
    store.addCare(owner, {
      id: noteId,
      person,
      level: "never",
      text: "Don't bring up hospitals.",
      since: "2026-05-14",
      ...over,
    });
    return noteId;
  };

  it("can be reworded, confirmed, retired and put back", () => {
    const file = openFile("Ana");
    const note = add(file);
    store.changeCare(ME, note, { level: "careful", text: "Careful with hospitals.", confirmed: "2026-10-01" });
    expect(store.load(ME).care[0]).toMatchObject({
      level: "careful",
      text: "Careful with hospitals.",
      since: "2026-05-14",
      confirmed: "2026-10-01",
      retired: null,
    });
    store.changeCare(ME, note, { retired: "2026-10-02" });
    expect(store.load(ME).care[0]?.retired).toBe("2026-10-02");
    store.changeCare(ME, note, { retired: null });
    expect(store.load(ME).care[0]?.retired).toBeNull();
  });

  it("checks its level, its day of the year and its source", () => {
    const file = openFile("Ana");
    const other = addEntry(openFile("Bia"));
    refused(() => add(file, { level: "always" }), 400);
    refused(() => add(file, { date: "13-01" }), 400);
    refused(() => add(file, { date: "02-30" }), 400);
    refused(() => add(file, { source: other }), 400);
    add(file, { date: "02-29" });
    expect(store.load(ME).care[0]?.date).toBe("02-29");
  });

  it("stays when its source entry is discarded", () => {
    const file = openFile("Ana");
    const draft = addEntry(file, { incomplete: true });
    const note = add(file, { source: draft });
    store.discardEntry(ME, draft);
    expect(store.load(ME).care.find((c) => c.id === note)?.source).toBeNull();
  });

  it("comes from an entry with !care, saved together with it", () => {
    const file = openFile("Ana");
    const entry = addEntry(file, { care: true, body: "Don't mention the divorce." });
    expect(store.load(ME).care[0]).toMatchObject({
      level: "careful",
      text: "Don't mention the divorce.",
      source: entry,
      since: "2026-10-05",
    });
  });

  it("isn't anyone else's", () => {
    const note = add(openFile("Ana"));
    refused(() => store.changeCare(OTHER, note, { retired: "2026-10-02" }), 404);
  });
});

describe("word given", () => {
  const add = (person: string, over: Record<string, unknown> = {}) => {
    const wordId = id();
    store.addWord(ME, { id: wordId, person, dir: "they", words: "I'll bring the book.", made: "2026-10-05", ...over });
    return wordId;
  };
  const word = (wordId: string) => store.load(ME).words.find((w) => w.id === wordId);

  it("needs no due date, and can't be due before it was given", () => {
    const file = openFile("Ana");
    expect(word(add(file))).toMatchObject({ due: null, outcome: "pending" });
    refused(() => add(file, { due: "2026-10-04" }), 400);
  });

  it("gets one outcome, undone only on the day it was given", () => {
    const file = openFile("Ana");
    const w = add(file);
    store.settleWord(ME, w, { outcome: "kept", on: "2026-10-10" });
    expect(word(w)).toMatchObject({ outcome: "kept", outcomeOn: "2026-10-10" });
    refused(() => store.settleWord(ME, w, { outcome: "broken", on: "2026-10-10" }), 409);
    refused(() => store.settleWord(ME, w, { outcome: "pending", on: "2026-10-11" }), 409);
    store.settleWord(ME, w, { outcome: "pending", on: "2026-10-10" });
    expect(word(w)).toMatchObject({ outcome: "pending", outcomeOn: null });
    store.settleWord(ME, w, { outcome: "broken", on: "2026-10-11" });
    expect(word(w)?.outcome).toBe("broken");
  });
});

describe("concerns", () => {
  const add = (person: string, ev: string[] = [], over: Record<string, unknown> = {}) => {
    const concernId = id();
    store.addConcern(ME, {
      id: concernId,
      person,
      text: "He may have presented my draft as his.",
      opened: "2026-10-10",
      review: "2026-10-24",
      ev,
      ...over,
    });
    return concernId;
  };
  const concern = (concernId: string) => store.load(ME).concerns.find((c) => c.id === concernId);
  const review = (concernId: string, state: string, on = "2026-10-24", note = "Reviewed.") =>
    store.reviewConcern(ME, concernId, { state, on, note });

  it("needs a review date after the day it was opened", () => {
    const file = openFile("Ana");
    refused(() => add(file, [], { review: "2026-10-10" }), 400);
    refused(() => add(file, [], { review: "2026-10-09" }), 400);
  });

  it("can't be decided before its review date, and can on the day", () => {
    const file = openFile("Ana");
    const c = add(file, [addEntry(file, { src: "O" })]);
    refused(() => review(c, "breach", "2026-10-23"), 409, /Review opens on 2026-10-24/);
    review(c, "breach", "2026-10-24");
    expect(concern(c)).toMatchObject({ state: "breach", reviewed: "2026-10-24", reviewNote: "Reviewed." });
  });

  it("needs a review note", () => {
    const file = openFile("Ana");
    const c = add(file);
    refused(() => review(c, "dismissed", "2026-10-24", "   "), 400);
  });

  it("can't become a breach with no evidence, or only my own conclusions", () => {
    const file = openFile("Ana");
    const none = add(file);
    refused(() => review(none, "breach"), 409, /beyond my own conclusions/);
    const mine = add(file, [addEntry(file, { src: "N" })]);
    refused(() => review(mine, "breach"), 409, /beyond my own conclusions/);
    store.changeConcern(ME, mine, { ev: [addEntry(file, { src: "U" })] });
    review(mine, "breach");
    expect(concern(mine)?.state).toBe("breach");
  });

  it("can be dismissed with no evidence", () => {
    const c = add(openFile("Ana"));
    review(c, "dismissed");
    expect(concern(c)?.state).toBe("dismissed");
  });

  it("is final once reviewed, evidence included", () => {
    const file = openFile("Ana");
    const c = add(file);
    review(c, "dismissed");
    refused(() => review(c, "breach"), 409);
    refused(() => store.changeConcern(ME, c, { ev: [addEntry(file)] }), 409);
  });

  it("takes evidence only from its own file", () => {
    const ana = openFile("Ana");
    const hers = addEntry(openFile("Bia"));
    refused(() => add(ana, [hers]), 400);
  });

  it("loses evidence that is discarded, so it can't become a breach on it", () => {
    const file = openFile("Ana");
    const draft = addEntry(file, { incomplete: true, src: "O" });
    const c = add(file, [draft]);
    store.discardEntry(ME, draft);
    expect(concern(c)?.ev).toEqual([]);
    refused(() => review(c, "breach"), 409);
  });
});

describe("reports of what was said about me", () => {
  const add = (person: string, over: Record<string, unknown> = {}) => {
    const reportId = id();
    store.addReport(ME, {
      id: reportId,
      person,
      text: "Told Jussara I'm hard to work with.",
      by: "Jussara",
      told: DAY,
      hap: DAY,
      place: "Staff room",
      ...over,
    });
    return reportId;
  };

  it("are kept apart from the entries, with their own logged-at", () => {
    const file = openFile("Ana");
    const before = store.load(ME).entries.length;
    const r = add(file);
    const after = store.load(ME);
    expect(after.entries).toHaveLength(before);
    expect(after.reports[0]).toMatchObject({ id: r, person: file, by: "Jussara" });
    expect(after.reports[0]?.logged).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("can't be changed, even in the database", () => {
    const r = add(openFile("Ana"));
    expect(() => db.prepare("UPDATE reports SET text = 'x' WHERE id = ?").run(r)).toThrow(/never changed/);
    expect(() => db.prepare("UPDATE reports SET logged_at = 'x' WHERE id = ?").run(r)).toThrow(/never changed/);
  });

  it("can't be a concern's evidence, so a report alone proves nothing", () => {
    const file = openFile("Ana");
    const r = add(file);
    const c = id();
    refused(
      () =>
        store.addConcern(ME, { id: c, person: file, text: "x", opened: "2026-10-10", review: "2026-10-24", ev: [r] }),
      400,
    );
  });

  it("keep their place on the list", () => {
    add(openFile("Ana"));
    const place = store.load(ME).places[0]!;
    refused(() => store.removePlace(ME, place.id), 409);
  });

  it("check their dates", () => {
    const file = openFile("Ana");
    refused(() => add(file, { hap: { d: "2026-10-06", t: null, p: "date" } }), 400);
    refused(() => add(file, { text: " " }), 400);
  });
});

describe("corrections", () => {
  it("point to an entry in the same file, or to none", () => {
    const ana = openFile("Ana");
    const entry = addEntry(ana, { src: "N" });
    store.addCorrection(ME, { id: id(), person: ana, on: "2026-10-06", text: "I read her wrong.", entry });
    store.addCorrection(ME, { id: id(), person: ana, on: "2026-10-07", text: "Again.", entry: null });
    expect(store.load(ME).corrections.map((c) => c.entry)).toEqual([entry, null]);
    const hers = addEntry(openFile("Bia"));
    refused(() => store.addCorrection(ME, { id: id(), person: ana, on: "2026-10-06", text: "x", entry: hers }), 400);
  });
});

describe("to their credit", () => {
  it("can be set when written or later, without touching the words", () => {
    const file = openFile("Ana");
    const entry = addEntry(file, { credit: true });
    const later = addEntry(file);
    store.fileEntry(ME, later, { credit: true });
    const { entries } = store.load(ME);
    expect(entries.find((e) => e.id === entry)?.credit).toBe(true);
    expect(entries.find((e) => e.id === later)).toMatchObject({ credit: true, body: "Runs on Sundays." });
  });
});

describe("incidents", () => {
  const add = (people: string[], over: Record<string, unknown> = {}, owner = ME) => {
    const incidentId = id();
    store.addIncident(owner, {
      id: incidentId,
      title: "Rodrigo's arrest",
      status: "one",
      people,
      mentions: ["Rodrigo, Marcos's brother"],
      opened: "2026-09-23",
      ...over,
    });
    return incidentId;
  };
  const incident = (incidentId: string, owner = ME) => store.load(owner).incidents.find((i) => i.id === incidentId);
  const note = (incidentId: string, over: Record<string, unknown> = {}) => {
    const noteId = id();
    store.addIncidentNote(ME, incidentId, {
      id: noteId,
      text: "The hearing is set for mid-November.",
      by: "Jussara",
      told: DAY,
      hap: DAY,
      place: null,
      ...over,
    });
    return noteId;
  };

  it("involve at least one file of the same owner", () => {
    const mine = openFile("Ana");
    const hers = openFile("Bia", OTHER);
    refused(() => add([]), 400);
    refused(() => add([hers]), 404);
    expect(incident(add([mine]))?.people).toEqual([mine]);
  });

  it("keep the history of what was known", () => {
    const i = add([openFile("Ana")]);
    store.changeIncident(ME, i, { status: { to: "confirmed", on: "2026-10-01" } });
    store.changeIncident(ME, i, { status: { to: "confirmed", on: "2026-10-02" } });
    store.changeIncident(ME, i, { status: { to: "disproved", on: "2026-10-03" } });
    expect(incident(i)).toMatchObject({
      status: "disproved",
      history: [
        { on: "2026-09-23", status: "one" },
        { on: "2026-10-01", status: "confirmed" },
        { on: "2026-10-03", status: "disproved" },
      ],
    });
  });

  it("close with a note and reopen, keeping everything", () => {
    const i = add([openFile("Ana")]);
    note(i);
    store.changeIncident(ME, i, { closed: { on: "2026-10-30", note: "Settled." } });
    expect(incident(i)).toMatchObject({ closed: "2026-10-30", closeNote: "Settled." });
    expect(incident(i)?.notes).toHaveLength(1);
    store.changeIncident(ME, i, { closed: null });
    expect(incident(i)).toMatchObject({ closed: null, closeNote: "" });
  });

  it("take entries only from their own files", () => {
    const ana = openFile("Ana");
    const bia = openFile("Bia");
    const i = add([ana]);
    const entry = addEntry(ana, { incident: i });
    expect(store.load(ME).entries.find((e) => e.id === entry)?.incident).toBe(i);
    refused(() => addEntry(bia, { incident: i }), 400);
    const hers = addEntry(bia);
    refused(() => store.fileEntry(ME, hers, { incident: i }), 400);
    store.changeIncident(ME, i, { people: [ana, bia] });
    store.fileEntry(ME, hers, { incident: i });
    expect(store.load(ME).entries.find((e) => e.id === hers)?.incident).toBe(i);
  });

  it("unlink a file's entries when that file leaves the incident", () => {
    const ana = openFile("Ana");
    const bia = openFile("Bia");
    const i = add([ana, bia]);
    const hers = addEntry(bia, { incident: i });
    store.changeIncident(ME, i, { people: [ana] });
    expect(store.load(ME).entries.find((e) => e.id === hers)?.incident).toBeNull();
  });

  it("hold hearsay that can't be changed, and that isn't an entry", () => {
    const i = add([openFile("Ana")]);
    const before = store.load(ME).entries.length;
    const n = note(i);
    expect(store.load(ME).entries).toHaveLength(before);
    expect(incident(i)?.notes[0]).toMatchObject({ id: n, by: "Jussara" });
    expect(() => db.prepare("UPDATE incident_notes SET text = 'x' WHERE id = ?").run(n)).toThrow(/never changed/);
  });

  it("go when the last file in them is destroyed, and stay while one is left", () => {
    const ana = openFile("Ana");
    const bia = openFile("Bia");
    const both = add([ana, bia]);
    const hers = add([bia]);
    const entry = addEntry(ana, { incident: both });
    store.destroyFile(ME, bia);
    expect(incident(hers)).toBeUndefined();
    expect(incident(both)?.people).toEqual([ana]);
    expect(store.load(ME).entries.find((e) => e.id === entry)?.incident).toBe(both);
  });
});

describe("destroying a file", () => {
  it("takes everything of its own", () => {
    const file = openFile("Ana");
    const entry = addEntry(file);
    store.addCare(ME, { id: id(), person: file, level: "never", text: "x", since: "2026-10-05", source: entry });
    store.addWord(ME, { id: id(), person: file, dir: "me", words: "x", made: "2026-10-05" });
    store.addConcern(ME, {
      id: id(),
      person: file,
      text: "x",
      opened: "2026-10-05",
      review: "2026-10-06",
      ev: [entry],
    });
    store.addCorrection(ME, { id: id(), person: file, on: "2026-10-05", text: "x", entry });
    store.addReport(ME, { id: id(), person: file, text: "x", by: "", told: DAY, hap: DAY, place: null });
    store.destroyFile(ME, file);
    const after = store.load(ME);
    for (const list of [after.care, after.words, after.concerns, after.corrections, after.reports]) {
      expect(list).toEqual([]);
    }
    expect(db.prepare("SELECT COUNT(*) AS n FROM concern_evidence").get()).toEqual({ n: 0 });
  });
});

describe("removed users", () => {
  it("lose all of it, and nobody else does", () => {
    const gone = openFile("Ana", OTHER);
    store.addCare(OTHER, { id: id(), person: gone, level: "never", text: "x", since: "2026-10-05" });
    store.addReport(OTHER, { id: id(), person: gone, text: "x", by: "", told: DAY, hap: DAY, place: "Bakery" });
    const inc = id();
    store.addIncident(OTHER, { id: inc, title: "x", status: "one", people: [gone], opened: "2026-10-05" });
    store.addIncidentNote(OTHER, inc, { id: id(), text: "x", by: "", told: DAY, hap: DAY, place: "Bakery" });
    const mine = openFile("Bia");
    store.addCare(ME, { id: id(), person: mine, level: "never", text: "x", since: "2026-10-05" });
    store.removeUnknownOwners(new Set([ME]));
    expect(store.load(OTHER)).toEqual({
      people: [],
      places: [],
      entries: [],
      answers: [],
      care: [],
      words: [],
      concerns: [],
      corrections: [],
      reports: [],
      incidents: [],
    });
    expect(store.load(ME).care).toHaveLength(1);
  });
});

describe("the upgrade from version 1", () => {
  it("leaves every file, entry and answer as it was", () => {
    const dir = mkdtempSync(join(tmpdir(), "tyr-upgrade-"));
    const file = join(dir, "tyr.db");
    try {
      const v1 = openDatabase(file, 1);
      expect(v1.prepare("PRAGMA user_version").get()).toEqual({ user_version: 1 });
      v1.exec(`
        INSERT INTO drawers VALUES ('odin', 2, '2026-10-01T10:00:00.000Z');
        INSERT INTO people (id, owner, no, name, name_key, opened_on, created_at, updated_at)
          VALUES ('person-1', 'odin', 1, 'Álvaro', 'ALVARO', '2026-10-01', 'x', 'x');
        INSERT INTO places (id, owner, label, label_key) VALUES ('place-1', 'odin', 'Bakery', 'BAKERY');
        INSERT INTO entries (id, owner, person_id, logged_at, told_date, told_time, told_prec, hap_date, hap_prec,
            place_id, source, wording, body, category, certainty, conf, present, fu_date, fu_note)
          VALUES ('entry-1', 'odin', 'person-1', '2026-10-01T10:00:00.000Z', '2026-10-01', '09:30', 'date', '2009',
            'year', 'place-1', 'U', 'quote', 'I was there.', 'shaped', 'fair', 1, '["Ana"]', '2026-11-01', 'Ask');
        INSERT INTO answers (id, owner, person_id, question, text, revised_on, created_at)
          VALUES ('answer-1', 'odin', 'person-1', 'shaped', 'What shaped him.', '2026-10-01', 'x');
        INSERT INTO answer_evidence VALUES (1, 'entry-1');
      `);
      v1.close();

      const v2 = openDatabase(file);
      expect(v2.prepare("PRAGMA user_version").get()).toEqual({ user_version: 2 });
      store = createStore(v2);
      const after = store.load(ME);
      expect(after.people[0]).toMatchObject({ id: "person-1", name: "Álvaro", no: 1 });
      expect(after.entries).toEqual([
        {
          id: "entry-1",
          person: "person-1",
          logged: "2026-10-01T10:00:00.000Z",
          told: { d: "2026-10-01", t: "09:30", p: "date" },
          hap: { d: "2009", t: null, p: "year" },
          place: "place-1",
          setting: null,
          src: "U",
          wording: "quote",
          body: "I was there.",
          cat: "shaped",
          cert: "fair",
          conf: true,
          present: ["Ana"],
          ctx: "",
          fu: { date: "2026-11-01", note: "Ask", done: null },
          amends: null,
          contra: null,
          incomplete: false,
          credit: false,
          incident: null,
        },
      ]);
      expect(after.answers[0]).toMatchObject({ id: "answer-1", ev: ["entry-1"] });
      expect(() => v2.prepare("UPDATE entries SET logged_at = 'x' WHERE id = 'entry-1'").run()).toThrow(
        /never changes/,
      );
      // The next file continues the numbering.
      store.openFile(ME, {
        id: "person-2-id",
        name: "Bia",
        role: "",
        opened: "2026-10-05",
        entry: { ...fields("We met.", "O"), id: "entry-2-id", incomplete: false },
      });
      expect(store.load(ME).people.map((p) => p.no)).toEqual([1, 2]);
      v2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
