import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NewEntry, Stamp } from "../shared/protocol.ts";
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

function firstEntry(body = "We met.") {
  return {
    id: id(),
    told: DAY,
    hap: DAY,
    place: null,
    setting: null,
    src: "O",
    wording: "para",
    body,
    cat: null,
    cert: "sure",
    conf: false,
    present: [],
    ctx: "",
    fu: null,
    contra: null,
    incomplete: false,
  };
}

function openFile(name: string, owner = ME): string {
  const fileId = id();
  store.openFile(owner, { id: fileId, name, role: "", opened: "2026-10-05", entry: firstEntry() });
  return fileId;
}

function addEntry(person: string, over: Partial<NewEntry> = {}, owner = ME): string {
  const entryId = over.id ?? id();
  store.addEntry(owner, { ...firstEntry("Runs on Sundays."), src: "U", amends: null, ...over, id: entryId, person });
  return entryId;
}

const refused = (fn: () => void, status: number) => {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(StoreError);
  expect((caught as StoreError).status).toBe(status);
};

const entryOf = (entryId: string, owner = ME) => store.load(owner).entries.find((e) => e.id === entryId);

beforeEach(() => {
  db = openDatabase(":memory:");
  store = createStore(db);
});

describe("the drawer", () => {
  it("keeps each user's files apart", () => {
    const mine = openFile("Fernanda");
    const entry = addEntry(mine);
    expect(store.load(OTHER).people).toEqual([]);
    refused(() => addEntry(mine, {}, OTHER), 404);
    refused(() => store.changeFile(OTHER, mine, { role: "x" }), 404);
    refused(() => store.destroyFile(OTHER, mine), 404);
    refused(() => store.fileEntry(OTHER, entry, { cat: "joy" }), 404);
    expect(store.load(ME).people).toHaveLength(1);
  });

  it("refuses a name or alias another file answers to, ignoring accents and case", () => {
    const alvaro = openFile("Álvaro");
    refused(() => openFile("alvaro"), 409);
    const fernanda = openFile("Fernanda");
    store.changeFile(ME, fernanda, { aliases: ["Fê"] });
    refused(() => openFile("FE"), 409);
    refused(() => store.changeFile(ME, alvaro, { name: "Fernanda" }), 409);
    // Its own name again is fine.
    store.changeFile(ME, alvaro, { name: "Alvaro" });
    expect(store.load(ME).people.map((p) => p.name)).toEqual(["Alvaro", "Fernanda"]);
  });

  it("never uses a file's number twice, even after a file is destroyed", () => {
    const first = openFile("Ana");
    const second = openFile("Bia");
    store.destroyFile(ME, second);
    openFile("Caio");
    expect(store.load(ME).people.map((p) => p.no)).toEqual([1, 3]);
    expect(first).toBeTruthy();
  });

  it("destroying a file takes its entries and answers, and leaves others alone", () => {
    const gone = openFile("Ana");
    const stays = openFile("Bia");
    const evidence = addEntry(gone);
    store.addAnswer(ME, { id: id(), person: gone, q: "joy", text: "Dancing.", ev: [evidence], revised: "2026-10-06" });
    store.destroyFile(ME, gone);
    const after = store.load(ME);
    expect(after.people.map((p) => p.id)).toEqual([stays]);
    expect(after.entries.every((e) => e.person === stays)).toBe(true);
    expect(after.answers).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM answer_evidence").get()).toEqual({ n: 0 });
  });

  it("closes and reopens a file", () => {
    const file = openFile("Ana");
    store.changeFile(ME, file, { closed: { on: "2026-10-07", note: "Left the city." } });
    expect(store.load(ME).people[0]).toMatchObject({ closed: "2026-10-07", closeNote: "Left the city." });
    store.changeFile(ME, file, { closed: null });
    expect(store.load(ME).people[0]).toMatchObject({ closed: null, closeNote: "" });
  });

  it("saves a file sent twice once", () => {
    const fileId = id();
    const send = () =>
      store.openFile(ME, { id: fileId, name: "Ana", role: "", opened: "2026-10-05", entry: firstEntry() });
    send();
    send();
    const after = store.load(ME);
    expect(after.people).toHaveLength(1);
    expect(after.entries).toHaveLength(1);
  });
});

describe("entries", () => {
  it("sets logged-at itself, and the database refuses to change it", () => {
    const file = openFile("Ana");
    const entry = addEntry(file, { logged: "1999-01-01T00:00:00.000Z" } as never);
    const logged = entryOf(entry)?.logged;
    expect(logged).not.toBe("1999-01-01T00:00:00.000Z");
    expect(() => db.prepare("UPDATE entries SET logged_at = 'x' WHERE id = ?").run(entry)).toThrow(/never changes/);
    expect(entryOf(entry)?.logged).toBe(logged);
  });

  it("won't let a finished entry be rewritten, or discarded", () => {
    const file = openFile("Ana");
    const entry = addEntry(file);
    const { id: _, ...fields } = firstEntry("Something else.");
    refused(() => store.completeEntry(ME, entry, fields), 409);
    refused(() => store.discardEntry(ME, entry), 409);
    expect(entryOf(entry)?.body).toBe("Runs on Sundays.");
  });

  it("completes an incomplete entry, keeping logged-at, finished once it has a place and category", () => {
    const file = openFile("Ana");
    const entry = addEntry(file, { incomplete: true });
    const logged = entryOf(entry)?.logged;
    const { id: _, ...fields } = firstEntry("Runs 10 km on Sundays.");
    store.completeEntry(ME, entry, { ...fields, src: "U", place: "Courtyard" });
    expect(entryOf(entry)).toMatchObject({ body: "Runs 10 km on Sundays.", incomplete: true, logged });
    store.completeEntry(ME, entry, { ...fields, src: "U", place: "Courtyard", cat: "rhythms" });
    expect(entryOf(entry)?.incomplete).toBe(false);
  });

  it("discards an incomplete entry, and whatever amended it keeps standing", () => {
    const file = openFile("Ana");
    const draft = addEntry(file, { incomplete: true });
    const amending = addEntry(file, { amends: draft });
    store.discardEntry(ME, draft);
    expect(entryOf(draft)).toBeUndefined();
    expect(entryOf(amending)?.amends).toBeNull();
  });

  it("amending adds a new entry and leaves the original", () => {
    const file = openFile("Ana");
    const original = addEntry(file);
    const amending = addEntry(file, { amends: original, body: "It's Saturdays now." });
    expect(entryOf(original)?.body).toBe("Runs on Sundays.");
    expect(entryOf(amending)?.amends).toBe(original);
  });

  it("links only to entries in the same file", () => {
    const ana = openFile("Ana");
    const bia = openFile("Bia");
    const hers = addEntry(bia);
    refused(() => addEntry(ana, { amends: hers }), 400);
    refused(() => addEntry(ana, { contra: hers }), 400);
  });

  it("files any entry later, without touching what it says", () => {
    const file = openFile("Ana");
    const entry = addEntry(file, { fu: { date: "2026-11-20", note: "Ask how it went" } });
    store.fileEntry(ME, entry, { cat: "joy", fuDone: "2026-11-21" });
    expect(entryOf(entry)).toMatchObject({
      cat: "joy",
      body: "Runs on Sundays.",
      fu: { date: "2026-11-20", note: "Ask how it went", done: "2026-11-21" },
    });
    const without = addEntry(file);
    refused(() => store.fileEntry(ME, without, { fuDone: "2026-11-21" }), 400);
    refused(() => store.fileEntry(ME, entry, { cat: "nonsense" }), 400);
  });

  it("checks the moments", () => {
    const file = openFile("Ana");
    const bad: Stamp[] = [
      { d: "2026-02-31", t: null, p: "date" },
      { d: "2026-13", t: null, p: "month" },
      { d: "2026-10", t: null, p: "date" },
      { d: "2009", t: "14:00", p: "year" },
      { d: "2026-10-05", t: "25:00", p: "date" },
      { d: "2026-10-05", t: "teatime", p: "date" },
    ];
    for (const told of bad) refused(() => addEntry(file, { told, hap: told }), 400);
    for (const good of [
      { d: "2009", t: null, p: "around" },
      { d: "2026-10", t: null, p: "month" },
      { d: "2026-10-05", t: "evening", p: "date" },
    ] as Stamp[]) {
      addEntry(file, { told: good, hap: good });
    }
  });

  it("refuses something that happened after it was told, allowing for vagueness, unless it is my reading", () => {
    const file = openFile("Ana");
    const told: Stamp = { d: "2026-10-05", t: "10:00", p: "date" };
    const later: Stamp = { d: "2026-10-05", t: "11:00", p: "date" };
    refused(() => addEntry(file, { told, hap: later }), 400);
    addEntry(file, { told, hap: later, src: "N" });
    // Told sometime that day, or that month: the event can be anywhere in it.
    addEntry(file, { told: { d: "2026-10-05", t: null, p: "date" }, hap: later });
    addEntry(file, { told: { d: "2026-10", t: null, p: "month" }, hap: later });
  });

  it("refuses an unknown source: hearsay isn't one", () => {
    const file = openFile("Ana");
    refused(() => addEntry(file, { src: "H" as never }), 400);
    refused(() => addEntry(file, { body: "   " }), 400);
  });
});

describe("places", () => {
  it("finds a place whatever its accents and case, and adds a new one", () => {
    const file = openFile("Ana");
    addEntry(file, { place: "Cafetéria" });
    addEntry(file, { place: "cafeteria" });
    addEntry(file, { place: "Bus 402" });
    const { places, entries } = store.load(ME);
    expect(places.map((p) => p.label)).toEqual(["Bus 402", "Cafetéria"]);
    const cafe = places.find((p) => p.label === "Cafetéria")?.id;
    expect(entries.filter((e) => e.place === cafe)).toHaveLength(2);
  });

  it("renames a place everywhere, refuses a duplicate, and removes only an unused one", () => {
    const file = openFile("Ana");
    addEntry(file, { place: "Staf room" });
    store.addPlace(ME, { label: "Bakery", city: "" });
    refused(() => store.addPlace(ME, { label: "bakery", city: "" }), 409);
    const places = store.load(ME).places;
    const staff = places.find((p) => p.label === "Staf room")!.id;
    const bakery = places.find((p) => p.label === "Bakery")!.id;
    store.changePlace(ME, staff, { label: "Staff room", city: "" });
    refused(() => store.changePlace(ME, staff, { label: "BAKERY", city: "" }), 409);
    refused(() => store.removePlace(ME, staff), 409);
    store.removePlace(ME, bakery);
    expect(store.load(ME).places.map((p) => p.label)).toEqual(["Staff room"]);
    refused(() => store.removePlace(OTHER, staff), 404);
    expect(store.load(OTHER).places).toEqual([]);
  });
});

describe("profile answers", () => {
  it("keeps every revision, in order, with its evidence", () => {
    const file = openFile("Ana");
    const a = addEntry(file);
    const b = addEntry(file);
    const send = (text: string, ev: string[], revised: string) =>
      store.addAnswer(ME, { id: id(), person: file, q: "joy", text, ev, revised });
    send("Running.", [a], "2026-10-05");
    send("Running and her garden.", [a, b], "2026-10-06");
    const { answers } = store.load(ME);
    expect(answers.map((x) => x.text)).toEqual(["Running.", "Running and her garden."]);
    expect(answers[1]?.ev.toSorted()).toEqual([a, b].toSorted());
  });

  it("takes evidence only from the same file", () => {
    const ana = openFile("Ana");
    const hers = addEntry(openFile("Bia"));
    refused(
      () => store.addAnswer(ME, { id: id(), person: ana, q: "joy", text: "x", ev: [hers], revised: "2026-10-05" }),
      400,
    );
    refused(
      () => store.addAnswer(ME, { id: id(), person: ana, q: "nonsense", text: "x", ev: [], revised: "2026-10-05" }),
      400,
    );
  });
});

describe("removed users", () => {
  it("deletes everything of an owner Heimdall no longer knows, and nobody else's", () => {
    const gone = openFile("Ana", OTHER);
    addEntry(gone, { place: "Bakery" }, OTHER);
    store.addAnswer(OTHER, { id: id(), person: gone, q: "joy", text: "x", ev: [], revised: "2026-10-05" });
    const mine = openFile("Bia");
    expect(store.removeUnknownOwners(new Set([ME]))).toEqual([{ owner: OTHER, entries: 2 }]);
    expect(store.load(OTHER)).toEqual({ people: [], places: [], entries: [], answers: [] });
    expect(store.load(ME).people.map((p) => p.id)).toEqual([mine]);
  });
});

describe("on disk", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tyr-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps everything across a restart", () => {
    const file = join(dir, "tyr.db");
    let disk = openDatabase(file);
    store = createStore(disk);
    const person = openFile("Ana");
    const entry = addEntry(person, { place: "Bakery", conf: true });
    const before = store.load(ME);
    disk.close();

    disk = openDatabase(file);
    store = createStore(disk);
    expect(store.load(ME)).toEqual(before);
    expect(entryOf(entry)).toMatchObject({ conf: true, person });
    disk.close();
  });
});
