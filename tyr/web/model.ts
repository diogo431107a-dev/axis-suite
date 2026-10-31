// What the page works out from a drawer. Nothing here is stored: "today" moves, and so do these.
import {
  QUESTION_KEYS,
  type Answer,
  type Dossier,
  type Entry,
  type Person,
  type Question,
} from "../shared/protocol.ts";
import { fold, letterOf, stampKey } from "../shared/time.ts";
import { daysBetween } from "./time.ts";

/** Six months without contact. Also how long before an answer is worth checking again. */
export const DORMANT_DAYS = 183;

export type FileStatus = "active" | "dormant" | "closed";

export interface Thread {
  kind: "Follow-up" | "Incomplete";
  due: string | null;
  over: boolean;
  text: string;
  entry: string;
  person: string;
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
): { body: string; cat: Question | null; present: string[] } {
  let cat: Question | null = null;
  const present: string[] = [];
  const text = line
    .replace(/#(\p{L}+)/gu, (tag, word: string) => {
      const key = word.toLowerCase();
      const found = CAPTURE_TAGS[key] ?? (QUESTION_KEYS.includes(key) ? (key as Question) : null);
      if (!found) return tag;
      cat = found;
      return "";
    })
    .replace(/@(\p{L}+)/gu, (_, typed: string) => {
      const name = nameOf(typed) ?? typed;
      present.push(name);
      return name;
    });
  return { body: text.replace(/\s+/g, " ").trim(), cat, present };
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

  /** What is left open in a file, soonest first, undated last. */
  threads(person: string, today: string): Thread[] {
    const out: Thread[] = [];
    for (const e of this.entriesOf(person)) {
      if (e.fu && !e.fu.done) {
        out.push({
          kind: "Follow-up",
          due: e.fu.date,
          over: e.fu.date < today,
          text: e.fu.note,
          entry: e.id,
          person,
        });
      }
      if (e.incomplete) out.push({ kind: "Incomplete", due: null, over: false, text: e.body, entry: e.id, person });
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
