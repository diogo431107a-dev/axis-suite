import { describe, expect, it } from "vitest";
import type { CareNote, Concern, Dossier, Entry, Incident, Person, Stamp, WordGiven } from "../shared/protocol.ts";
import { evidenceCanProveBreach } from "../shared/rules.ts";
import { fold, happenedAfterTold, letterOf, stampKey } from "../shared/time.ts";
import { DORMANT_DAYS, Index, basisOf, drawerGroups, nextOccurrence, parseCapture } from "./model.ts";
import { addDays, daysBetween, parseDateText, showStamp, withPrecision } from "./time.ts";

const TODAY = "2026-10-31";
const day = (d: string): Stamp => ({ d, t: null, p: "date" });

const person = (over: Partial<Person> = {}): Person => ({
  id: "p1",
  no: 1,
  name: "Ana",
  aliases: [],
  role: "",
  matters: [],
  opened: "2026-01-01",
  closed: null,
  closeNote: "",
  ...over,
});

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: "e1",
  person: "p1",
  logged: "2026-10-01T10:00:00.000Z",
  told: day("2026-10-01"),
  hap: day("2026-10-01"),
  place: null,
  setting: null,
  src: "U",
  wording: "para",
  body: "x",
  cat: null,
  cert: "sure",
  conf: false,
  present: [],
  ctx: "",
  fu: null,
  amends: null,
  contra: null,
  incomplete: false,
  credit: false,
  incident: null,
  ...over,
});

const EMPTY = {
  places: [],
  answers: [],
  care: [],
  words: [],
  concerns: [],
  corrections: [],
  reports: [],
  incidents: [],
};
const index = (people: Person[], entries: Entry[], more: Partial<Dossier> = {}) =>
  new Index({ ...EMPTY, people, entries, ...more });

describe("the drawer", () => {
  it("files names under their letter with accents folded, and anything else under #", () => {
    expect(letterOf("Álvaro")).toBe("A");
    expect(letterOf("Ícaro")).toBe("I");
    expect(letterOf("Zé")).toBe("Z");
    expect(letterOf("  Çelik")).toBe("C");
    expect(letterOf("3PO")).toBe("#");
    expect(letterOf("Ωmega")).toBe("#");
    expect(fold("Fê")).toBe("FE");
  });

  it("sorts by first name within each letter", () => {
    const groups = drawerGroups([
      person({ id: "a", name: "Bruno" }),
      person({ id: "b", name: "Álvaro" }),
      person({ id: "c", name: "Ana" }),
    ]);
    expect([...groups.keys()]).toEqual(["A", "B"]);
    expect(groups.get("A")?.map((p) => p.name)).toEqual(["Álvaro", "Ana"]);
  });

  it("finds a file by name or alias, however typed", () => {
    const ix = index([person({ name: "Fernanda", aliases: ["Fê"] })], []);
    expect(ix.findPerson(" fernanda ")?.id).toBe("p1");
    expect(ix.findPerson("FE")?.id).toBe("p1");
    expect(ix.findPerson("")).toBeUndefined();
  });
});

describe("file status", () => {
  it("goes dormant after six months without contact", () => {
    const within = addDays(TODAY, -DORMANT_DAYS);
    const past = addDays(TODAY, -DORMANT_DAYS - 1);
    const p = person();
    expect(index([p], [entry({ told: day(within) })]).status(p, TODAY)).toBe("active");
    expect(index([p], [entry({ told: day(past) })]).status(p, TODAY)).toBe("dormant");
  });

  it("doesn't count my own conclusions as contact", () => {
    const p = person();
    const old = entry({ id: "old", told: day("2025-01-01") });
    const reading = entry({ id: "mine", told: day(TODAY), src: "N" });
    const ix = index([p], [old, reading]);
    expect(ix.lastContact("p1")?.id).toBe("old");
    expect(ix.status(p, TODAY)).toBe("dormant");
  });

  it("counts from the day the file was opened if there is no contact, and handles vague dates", () => {
    expect(index([person({ opened: "2026-10-01" })], []).status(person({ opened: "2026-10-01" }), TODAY)).toBe(
      "active",
    );
    const p = person();
    const vague = entry({ told: { d: "2019", t: null, p: "year" } });
    expect(index([p], [vague]).status(p, TODAY)).toBe("dormant");
  });

  it("a closed file is closed, whatever else", () => {
    const p = person({ closed: "2026-06-30" });
    expect(index([p], [entry({ told: day(TODAY) })]).status(p, TODAY)).toBe("closed");
  });
});

describe("threads", () => {
  it("lists follow-ups not done, and incomplete entries, soonest first", () => {
    const ix = index(
      [person()],
      [
        entry({ id: "a", fu: { date: "2026-12-01", note: "later", done: null } }),
        entry({ id: "b", fu: { date: "2026-10-01", note: "overdue", done: null } }),
        entry({ id: "c", fu: { date: "2026-01-01", note: "done", done: "2026-01-02" } }),
        entry({ id: "d", incomplete: true, body: "capture" }),
      ],
    );
    const threads = ix.threads("p1", TODAY);
    expect(threads.map((t) => t.entry)).toEqual(["b", "a", "d"]);
    expect(threads[0]?.over).toBe(true);
    expect(ix.overdueCount(TODAY)).toBe(1);
  });

  it("doesn't count a closed file's as overdue", () => {
    const ix = index(
      [person({ closed: "2026-06-30" })],
      [entry({ fu: { date: "2026-01-01", note: "x", done: null } })],
    );
    expect(ix.overdueCount(TODAY)).toBe(0);
  });
});

describe("the profile", () => {
  it("names the basis of an answer from its evidence", () => {
    const of = (...srcs: Entry["src"][]) => basisOf(srcs.map((src) => entry({ src }))).label;
    expect(of()).toBe("My reading · no entries");
    expect(of("U")).toBe("Their words");
    expect(of("I")).toBe("Their words · invited");
    expect(of("U", "I")).toBe("Their words");
    expect(of("O")).toBe("Observed");
    expect(of("U", "O")).toBe("Words and observed");
    expect(of("N")).toBe("My reading");
    expect(of("U", "N")).toBe("Partly inferred");
  });

  it("doesn't let a prompted entry fill a gap", () => {
    const ix = index(
      [person()],
      [entry({ id: "a", src: "P", cat: "fears" }), entry({ id: "b", src: "U", cat: "joy" })],
    );
    const gaps = ix.gaps("p1");
    expect(gaps).toContain("fears");
    expect(gaps).not.toContain("joy");
  });

  it("a contradiction between entries fills that gap", () => {
    expect(index([person()], [entry({ contra: "x" })]).gaps("p1")).not.toContain("contra");
    expect(index([person()], [entry()]).gaps("p1")).toContain("contra");
  });
});

describe("dates", () => {
  it("reads what is typed", () => {
    expect(parseDateText("today", TODAY)).toEqual({ d: TODAY, p: "date" });
    expect(parseDateText("Yesterday", TODAY)).toEqual({ d: "2026-10-30", p: "date" });
    expect(parseDateText("-3", TODAY)).toEqual({ d: "2026-10-28", p: "date" });
    expect(parseDateText("2026-10-31", TODAY)).toEqual({ d: "2026-10-31", p: "date" });
    expect(parseDateText("2026-10", TODAY)).toEqual({ d: "2026-10", p: "month" });
    expect(parseDateText("2009", TODAY)).toEqual({ d: "2009", p: "year" });
    expect(parseDateText("~2009", TODAY)).toEqual({ d: "2009", p: "around" });
    expect(parseDateText("c. 2009", TODAY)).toEqual({ d: "2009", p: "around" });
  });

  it("refuses what isn't a date", () => {
    for (const text of ["", "2026-02-31", "2026-13", "31/10/2026", "soon", "2026-1-1"]) {
      expect(parseDateText(text, TODAY)).toBeNull();
    }
  });

  it("sorts a vague date by the start of its range, and bands by their hour", () => {
    expect(stampKey({ d: "2009", t: null, p: "year" })).toBe("2009-01-01 00:00");
    expect(stampKey({ d: "2009", t: null, p: "around" })).toBe("2009-01-01 00:00");
    expect(stampKey({ d: "2026-10", t: null, p: "month" })).toBe("2026-10-01 00:00");
    expect(stampKey({ d: "2026-10-05", t: "evening", p: "date" })).toBe("2026-10-05 19:00");
    expect(stampKey({ d: "2026-10-05", t: "07:15", p: "date" })).toBe("2026-10-05 07:15");
  });

  it("compares happened and told across a vague range", () => {
    const told: Stamp = { d: "2026-10-05", t: "10:00", p: "date" };
    expect(happenedAfterTold({ d: "2026-10-05", t: "11:00", p: "date" }, told)).toBe(true);
    expect(happenedAfterTold({ d: "2026-10-05", t: "09:00", p: "date" }, told)).toBe(false);
    expect(happenedAfterTold({ d: "2026-10-20", t: null, p: "date" }, { d: "2026-10", t: null, p: "month" })).toBe(
      false,
    );
    expect(happenedAfterTold({ d: "2027", t: null, p: "year" }, { d: "2026", t: null, p: "year" })).toBe(true);
  });

  it("shows moments in ISO, and keeps vagueness visible", () => {
    expect(showStamp({ d: "2009", t: null, p: "around" })).toBe("c. 2009");
    expect(showStamp({ d: "2026-10-05", t: "07:15", p: "date" })).toBe("2026-10-05 07:15");
    expect(showStamp({ d: "2026-10-05", t: "evening", p: "date" })).toBe("2026-10-05 · evening");
    expect(showStamp({ d: "2026-10", t: null, p: "month" })).toBe("2026-10");
  });

  it("changes a date's precision", () => {
    expect(withPrecision("2026-10-31", "month", TODAY)).toBe("2026-10");
    expect(withPrecision("2026-10-31", "around", TODAY)).toBe("~2026");
    expect(withPrecision("2009", "date", TODAY)).toBe("2009-01-01");
  });

  it("counts days", () => {
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });
});

describe("Muninn", () => {
  const nameOf = (typed: string) => (typed.toLowerCase() === "fe" ? "Fernanda" : undefined);

  it("takes the category and who else was there from the line", () => {
    expect(parseCapture("Exam on Friday, nervous #chapter", nameOf)).toEqual({
      body: "Exam on Friday, nervous",
      cat: "chapter",
      present: [],
      care: false,
    });
    expect(parseCapture("Lunch with @fe and @Paulo #fear", nameOf)).toEqual({
      body: "Lunch with Fernanda and Paulo",
      cat: "fears",
      present: ["Fernanda", "Paulo"],
      care: false,
    });
  });

  it("takes !care from the line", () => {
    expect(parseCapture("Don't mention the divorce !care #fear", nameOf)).toEqual({
      body: "Don't mention the divorce",
      cat: "fears",
      present: [],
      care: true,
    });
  });

  it("leaves an unknown tag in the text", () => {
    expect(parseCapture("Loves #chess a lot", nameOf)).toEqual({
      body: "Loves #chess a lot",
      cat: null,
      present: [],
      care: false,
    });
  });
});

const word = (over: Partial<WordGiven> = {}): WordGiven => ({
  id: "w1",
  person: "p1",
  dir: "they",
  words: "I'll bring the book.",
  made: "2026-10-01",
  due: null,
  outcome: "pending",
  outcomeOn: null,
  source: null,
  ...over,
});

const concern = (over: Partial<Concern> = {}): Concern => ({
  id: "c1",
  person: "p1",
  text: "A worry.",
  opened: "2026-10-01",
  review: "2026-11-15",
  state: "open",
  ev: [],
  reviewNote: "",
  reviewed: null,
  ...over,
});

const care = (over: Partial<CareNote> = {}): CareNote => ({
  id: "n1",
  person: "p1",
  level: "careful",
  text: "Be gentle.",
  date: null,
  since: "2026-01-01",
  source: null,
  confirmed: "2026-01-01",
  retired: null,
  ...over,
});

const incident = (over: Partial<Incident> = {}): Incident => ({
  id: "i1",
  title: "The arrest",
  status: "one",
  people: ["p1"],
  mentions: [],
  opened: "2026-09-01",
  closed: null,
  closeNote: "",
  history: [],
  notes: [],
  ...over,
});

describe("what is left open", () => {
  const kinds = (more: Partial<Dossier>) => index([person()], [], more).threads("p1", TODAY);

  it("counts word given as overdue only with a date that has passed", () => {
    const threads = kinds({
      words: [
        word({ id: "a", due: "2026-10-30" }),
        word({ id: "b", due: TODAY }),
        word({ id: "c" }),
        word({ id: "d", due: "2026-01-01", outcome: "kept" }),
      ],
    });
    expect(threads.map((t) => [t.key, t.over])).toEqual([
      ["word-a", true],
      ["word-b", false],
      ["word-c", false],
    ]);
  });

  it("puts a concern up for review on its exact day", () => {
    const over = (review: string) => kinds({ concerns: [concern({ review })] })[0]?.over;
    expect(over("2026-11-01")).toBe(false);
    expect(over(TODAY)).toBe(true);
    expect(over("2026-10-30")).toBe(true);
    expect(kinds({ concerns: [concern({ state: "dismissed" })] })).toEqual([]);
  });

  it("shows a hard date from 30 days ahead, and retires with its note", () => {
    const gentle = (date: string, over: Partial<CareNote> = {}) => kinds({ care: [care({ date, ...over })] });
    expect(gentle("11-30")[0]).toMatchObject({ kind: "Gentle week", due: "2026-11-30" });
    expect(gentle("12-01")).toEqual([]);
    expect(gentle("11-15", { retired: "2026-10-01" })).toEqual([]);
  });

  it("lists an open incident undated and last, and not a closed one", () => {
    const threads = kinds({ incidents: [incident()], words: [word({ due: "2026-12-01" })] });
    expect(threads.map((t) => t.kind)).toEqual(["Word given", "Incident"]);
    expect(kinds({ incidents: [incident({ closed: "2026-10-01" })] })).toEqual([]);
  });

  it("leaves a closed file's threads out of the overdue count", () => {
    const words = [word({ due: "2026-01-01" })];
    expect(index([person()], [], { words }).overdueCount(TODAY)).toBe(1);
    expect(index([person({ closed: "2026-06-30" })], [], { words }).overdueCount(TODAY)).toBe(0);
  });
});

describe("hard dates", () => {
  it("come round each year, staying for six days after", () => {
    expect(nextOccurrence("11-15", TODAY)).toBe("2026-11-15");
    expect(nextOccurrence("10-25", TODAY)).toBe("2026-10-25");
    expect(nextOccurrence("10-24", TODAY)).toBe("2027-10-24");
    expect(nextOccurrence("01-05", "2026-12-30")).toBe("2027-01-05");
  });

  it("fall on 02-28 in a year with no 02-29", () => {
    expect(nextOccurrence("02-29", "2027-01-10")).toBe("2027-02-28");
    expect(nextOccurrence("02-29", "2028-01-10")).toBe("2028-02-29");
  });
});

describe("an incident's steps", () => {
  it("merges entries from any of its files with hearsay, in the order they happened", () => {
    const note = {
      id: "h1",
      logged: "x",
      told: day("2026-10-14"),
      hap: day("2026-09-20"),
      place: null,
      text: "Heard it.",
      by: "Jussara",
    };
    const inc = incident({ people: ["p1", "p2"], notes: [note] });
    const ix = index(
      [person(), person({ id: "p2", name: "Bia" })],
      [
        entry({ id: "late", incident: "i1", hap: day("2026-09-21") }),
        entry({ id: "early", person: "p2", incident: "i1", hap: day("2026-09-19") }),
        entry({ id: "other" }),
      ],
      { incidents: [inc] },
    );
    expect(ix.incidentSteps(inc).map((s) => (s.kind === "entry" ? s.entry.id : s.note.id))).toEqual([
      "early",
      "h1",
      "late",
    ]);
  });
});

describe("a breach", () => {
  it("needs evidence beyond my own conclusions", () => {
    expect(evidenceCanProveBreach([])).toBe(false);
    expect(evidenceCanProveBreach(["N", "N"])).toBe(false);
    expect(evidenceCanProveBreach(["N", "O"])).toBe(true);
    expect(evidenceCanProveBreach(["P"])).toBe(true);
  });
});
