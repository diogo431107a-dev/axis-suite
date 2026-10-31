// What the page works out from a drawer. Nothing here is stored: "today" moves, and so do these.
import {
  QUESTION_KEYS,
  type Answer,
  type CareNote,
  type Concern,
  type Correction,
  type Dossier,
  type Entry,
  type Hearsay,
  type Incident,
  type Person,
  type Question,
  type Report,
  type WordGiven,
} from "../shared/protocol.ts";
import { fold, isDate, letterOf, stampKey } from "../shared/time.ts";
import { daysBetween } from "./time.ts";

/** Six months without contact. Also how long before an answer is worth checking again. */
export const DORMANT_DAYS = 183;

export type FileStatus = "active" | "dormant" | "closed";

/** How many days ahead a hard date starts to show, and how long after it is still shown. */
const GENTLE_AHEAD = 30;
const GENTLE_AFTER = 6;

export interface Thread {
  /** One thing left open: an incident with two files in it has one key. */
  key: string;
  kind: "Follow-up" | "Incomplete" | "Word given" | "Concern" | "Gentle week" | "Incident";
  due: string | null;
  over: boolean;
  text: string;
  /** The entry it is about, if it is about one. */
  entry: string | null;
  person: string;
}

/** How a thread's date reads. */
export function threadDate(t: Thread): string {
  if (!t.due) return t.kind;
  if (!t.over) return t.due;
  return `${t.kind === "Concern" ? "review" : "overdue"} ${t.due}`;
}

/** A step of an incident: an entry, or hearsay that is kept in the incident. */
export type IncidentStep = { kind: "entry"; entry: Entry } | { kind: "hearsay"; note: Hearsay };

/** The next time a day of the year comes round, counting one just past as still here. */
export function nextOccurrence(monthDay: string, today: string): string {
  const inYear = (year: number) => {
    const date = `${year}-${monthDay}`;
    return isDate(date) ? date : `${year}-02-28`;
  };
  const year = Number(today.slice(0, 4));
  const thisYear = inYear(year);
  return daysBetween(thisYear, today) > GENTLE_AFTER ? inYear(year + 1) : thisYear;
}

export type BasisKind = "words" | "obs" | "mixed" | "mine";

/** Newest first, by when it was told. */
export const byToldDesc = (a: Entry, b: Entry): number => stampKey(b.told).localeCompare(stampKey(a.told));

/** Where the words behind an answer come from, shown beside it. */
export function basisOf(evidence: readonly Entry[]): { kind: BasisKind; label: string } {
  const sources = new Set(evidence.map((e) => e.src));
  const words = sources.has("U") || sources.has("I");
  const seen = sources.has("O");
  const mine = sources.has("N");
  if (evidence.length === 0) return { kind: "mine", label: "My reading · no entries" };
  if (mine && !words && !seen) return { kind: "mine", label: "My reading" };
  if (mine) return { kind: "mixed", label: "Partly inferred" };
  if (seen && words) return { kind: "obs", label: "Words and observed" };
  if (seen) return { kind: "obs", label: "Observed" };
  if (sources.has("I") && !sources.has("U")) return { kind: "words", label: "Their words · invited" };
  return { kind: "words", label: "Their words" };
}

/** Sorted A to Z by first name, accents folded, with the letter each falls under. */
export function drawerGroups(people: readonly Person[]): Map<string, Person[]> {
  const sorted = [...people].sort((a, b) => fold(a.name).localeCompare(fold(b.name)));
  const groups = new Map<string, Person[]>();
  for (const person of sorted) {
    const letter = letterOf(person.name);
    groups.set(letter, [...(groups.get(letter) ?? []), person]);
  }
  return groups;
}

const CAPTURE_TAGS: Record<string, Question> = {
  drive: "drives",
  want: "wants",
  value: "values",
  fear: "fears",
  like: "likes",
  irk: "irks",
  hope: "hopes",
  rhythm: "rhythms",
};

/** Muninn's line: @name says who else was there, and #fear or #joy files it. */
export function parseCapture(
  line: string,
  nameOf: (typed: string) => string | undefined,
): { body: string; cat: Question | null; present: string[]; care: boolean } {
  let cat: Question | null = null;
  let care = false;
  const present: string[] = [];
  const text = line
    .replace(/#(\p{L}+)/gu, (tag, word: string) => {
      const key = word.toLowerCase();
      const found = CAPTURE_TAGS[key] ?? (QUESTION_KEYS.includes(key) ? (key as Question) : null);
      if (!found) return tag;
      cat = found;
      return "";
    })
    .replace(/!care\b/giu, () => {
      care = true;
      return "";
    })
    .replace(/@(\p{L}+)/gu, (_, typed: string) => {
      const name = nameOf(typed) ?? typed;
      present.push(name);
      return name;
    });
  return { body: text.replace(/\s+/g, " ").trim(), cat, present, care };
}

/** A drawer, indexed for the page. Made anew each time it is loaded. */
export class Index {
  readonly dossier: Dossier;
  private readonly people = new Map<string, Person>();
  private readonly entries = new Map<string, Entry>();
  private readonly places = new Map<string, string>();
  private readonly ofPerson = new Map<string, Entry[]>();

  constructor(dossier: Dossier) {
    this.dossier = dossier;
    for (const p of dossier.people) this.people.set(p.id, p);
    for (const p of dossier.places) this.places.set(p.id, p.city ? `${p.label} (${p.city})` : p.label);
    for (const e of dossier.entries) {
      this.entries.set(e.id, e);
      this.ofPerson.set(e.person, [...(this.ofPerson.get(e.person) ?? []), e]);
    }
  }

  person(id: string | null): Person | undefined {
    return id === null ? undefined : this.people.get(id);
  }

  entry(id: string | null): Entry | undefined {
    return id === null ? undefined : this.entries.get(id);
  }

  placeLabel(id: string | null): string {
    return id === null ? "" : (this.places.get(id) ?? "");
  }

  /** A place's own label, without its city: what a form is filled with. */
  placeName(id: string | null): string {
    return this.dossier.places.find((p) => p.id === id)?.label ?? "";
  }

  entriesOf(person: string): Entry[] {
    return this.ofPerson.get(person) ?? [];
  }

  /** Finds a file by a name or nickname, however it was typed. */
  findPerson(typed: string): Person | undefined {
    const key = fold(typed.trim());
    if (!key) return undefined;
    return this.dossier.people.find((p) => fold(p.name) === key || p.aliases.some((a) => fold(a) === key));
  }

  /** The last time they were seen or heard. My own conclusions are not contact. */
  lastContact(person: string): Entry | undefined {
    return this.entriesOf(person)
      .filter((e) => e.src !== "N")
      .sort(byToldDesc)[0];
  }

  status(p: Person, today: string): FileStatus {
    if (p.closed) return "closed";
    const last = this.lastContact(p.id);
    const since = last ? stampKey(last.told).slice(0, 10) : p.opened;
    return daysBetween(since, today) > DORMANT_DAYS ? "dormant" : "active";
  }

  /** Every version of an answer, oldest first. */
  answersTo(person: string, q: Question): Answer[] {
    return this.dossier.answers.filter((a) => a.person === person && a.q === q);
  }

  /** A file's care notes still in force. */
  careOf(person: string): CareNote[] {
    return this.dossier.care.filter((c) => c.person === person && !c.retired);
  }

  retiredCareOf(person: string): CareNote[] {
    return this.dossier.care.filter((c) => c.person === person && c.retired);
  }

  wordsOf(person: string): WordGiven[] {
    return this.dossier.words.filter((w) => w.person === person);
  }

  concernsOf(person: string): Concern[] {
    return this.dossier.concerns.filter((c) => c.person === person);
  }

  correctionsOf(person: string): Correction[] {
    return this.dossier.corrections.filter((c) => c.person === person);
  }

  /** What they reportedly said about me, newest first. Hearsay, so never mixed with the entries. */
  reportsOf(person: string): Report[] {
    return this.dossier.reports
      .filter((r) => r.person === person)
      .sort((a, b) => stampKey(b.told).localeCompare(stampKey(a.told)));
  }

  incidentsOf(person: string): Incident[] {
    return this.dossier.incidents.filter((i) => i.people.includes(person));
  }

  /** The latest things to their credit, shown beside an open concern. */
  creditsOf(person: string): Entry[] {
    return this.entriesOf(person)
      .filter((e) => e.credit)
      .sort(byToldDesc)
      .slice(0, 3);
  }

  /** An incident's entries and hearsay in the order they happened. */
  incidentSteps(incident: Incident): IncidentStep[] {
    const entries: IncidentStep[] = this.dossier.entries
      .filter((e) => e.incident === incident.id)
      .map((entry) => ({ kind: "entry", entry }));
    const notes: IncidentStep[] = incident.notes.map((note) => ({ kind: "hearsay", note }));
    const happened = (s: IncidentStep) => stampKey(s.kind === "entry" ? s.entry.hap : s.note.hap);
    return [...entries, ...notes].sort((a, b) => happened(a).localeCompare(happened(b)));
  }

  /** What is left open in a file, soonest first, undated last. */
  threads(person: string, today: string): Thread[] {
    const out: Thread[] = [];
    for (const e of this.entriesOf(person)) {
      if (e.fu && !e.fu.done) {
        out.push({
          key: `fu-${e.id}`,
          kind: "Follow-up",
          due: e.fu.date,
          over: e.fu.date < today,
          text: e.fu.note,
          entry: e.id,
          person,
        });
      }
      if (e.incomplete) {
        out.push({ key: `in-${e.id}`, kind: "Incomplete", due: null, over: false, text: e.body, entry: e.id, person });
      }
    }
    for (const w of this.wordsOf(person)) {
      if (w.outcome !== "pending") continue;
      out.push({
        key: `word-${w.id}`,
        kind: "Word given",
        due: w.due,
        over: w.due !== null && w.due < today,
        text: `${w.dir === "me" ? "I promised" : "They promised"}: “${w.words}”`,
        entry: null,
        person,
      });
    }
    for (const c of this.concernsOf(person)) {
      if (c.state !== "open") continue;
      out.push({
        key: `concern-${c.id}`,
        kind: "Concern",
        due: c.review,
        over: c.review <= today,
        text: c.text,
        entry: null,
        person,
      });
    }
    for (const c of this.careOf(person)) {
      if (!c.date) continue;
      const next = nextOccurrence(c.date, today);
      if (daysBetween(today, next) > GENTLE_AHEAD) continue;
      out.push({ key: `care-${c.id}`, kind: "Gentle week", due: next, over: false, text: c.text, entry: null, person });
    }
    for (const i of this.incidentsOf(person)) {
      if (i.closed) continue;
      out.push({ key: `inc-${i.id}`, kind: "Incident", due: null, over: false, text: i.title, entry: null, person });
    }
    return out.sort((a, b) => (a.due ?? "9").localeCompare(b.due ?? "9"));
  }

  openFiles(): Person[] {
    return this.dossier.people.filter((p) => !p.closed);
  }

  overdueCount(today: string): number {
    return this.openFiles().reduce((n, p) => n + this.threads(p.id, today).filter((t) => t.over).length, 0);
  }

  /** The questions nothing has been written or heard for yet. Prompted entries don't count. */
  gaps(person: string): (typeof QUESTION_KEYS)[number][] {
    const entries = this.entriesOf(person);
    return QUESTION_KEYS.filter((q) => {
      if (this.answersTo(person, q as Question).length > 0) return false;
      if (q === "contra" && entries.some((e) => e.contra)) return false;
      return !entries.some((e) => e.cat === q && e.src !== "P");
    });
  }
}
