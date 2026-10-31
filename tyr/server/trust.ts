// Care and trust in a file: care notes, word given, concerns, corrections, and reports of what was
// said about me. A worry has to wait for its review, and a report alone never proves anything.
import type { DatabaseSync } from "node:sqlite";
import {
  CARE_LEVELS,
  LIMITS,
  OUTCOMES,
  type CareLevel,
  type CareNote,
  type Concern,
  type ConcernState,
  type Correction,
  type Outcome,
  type Precision,
  type Report,
  type Source,
  type WordGiven,
} from "../shared/protocol.ts";
import { evidenceCanProveBreach } from "../shared/rules.ts";
import { isMonthDay } from "../shared/time.ts";
import {
  checkedHearsay,
  day,
  newId,
  object,
  oneOf,
  optionalDay,
  optionalId,
  personField,
  required,
  type Checks,
} from "./check.ts";
import { conflict, invalid, notFound, transaction } from "./errors.ts";

export interface Trust {
  addCare(owner: string, input: unknown): void;
  changeCare(owner: string, id: string, input: unknown): void;
  addWord(owner: string, input: unknown): void;
  settleWord(owner: string, id: string, input: unknown): void;
  addConcern(owner: string, input: unknown): void;
  changeConcern(owner: string, id: string, input: unknown): void;
  reviewConcern(owner: string, id: string, input: unknown): void;
  addCorrection(owner: string, input: unknown): void;
  addReport(owner: string, input: unknown): void;
}

function monthDay(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return isMonthDay(value) ? value : invalid("A hard date needs a day of the year, like 11-15");
}

function evidenceList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > LIMITS.evidence) invalid("The evidence isn't valid");
  return [...new Set(value.map(String))];
}

interface CareRow {
  id: string;
  person_id: string;
  level: string;
  text: string;
  on_date: string | null;
  since: string;
  source_id: string | null;
  confirmed_on: string;
  retired_on: string | null;
}

interface WordRow {
  id: string;
  person_id: string;
  direction: string;
  words: string;
  made_on: string;
  due_on: string | null;
  outcome: string;
  outcome_on: string | null;
  source_id: string | null;
}

interface ConcernRow {
  id: string;
  person_id: string;
  text: string;
  opened_on: string;
  review_on: string;
  state: string;
  review_note: string;
  reviewed_on: string | null;
}

interface ReportRow {
  id: string;
  person_id: string;
  logged_at: string;
  told_date: string;
  told_time: string | null;
  told_prec: string;
  hap_date: string;
  hap_time: string | null;
  hap_prec: string;
  place_id: string | null;
  text: string;
  told_by: string;
}

export function createTrust(db: DatabaseSync, checks: Checks, now: () => string) {
  const { alreadySaved, checkLinked, placeId, requirePerson } = checks;

  function concernRow(owner: string, id: string): ConcernRow {
    const row = db.prepare("SELECT * FROM concerns WHERE id = ? AND owner = ?").get(id, owner) as
      ConcernRow | undefined;
    return row ?? notFound("concern");
  }

  function setEvidence(concern: string, ev: string[]): void {
    db.prepare("DELETE FROM concern_evidence WHERE concern_id = ?").run(concern);
    const link = db.prepare("INSERT INTO concern_evidence (concern_id, entry_id) VALUES (?, ?)");
    for (const entry of ev) link.run(concern, entry);
  }

  return {
    loadTrust(owner: string) {
      const care: CareNote[] = (
        db.prepare("SELECT * FROM care_notes WHERE owner = ? ORDER BY since, id").all(owner) as unknown as CareRow[]
      ).map((r) => ({
        id: r.id,
        person: r.person_id,
        level: r.level as CareLevel,
        text: r.text,
        date: r.on_date,
        since: r.since,
        source: r.source_id,
        confirmed: r.confirmed_on,
        retired: r.retired_on,
      }));
      const words: WordGiven[] = (
        db.prepare("SELECT * FROM words_given WHERE owner = ? ORDER BY made_on, id").all(owner) as unknown as WordRow[]
      ).map((r) => ({
        id: r.id,
        person: r.person_id,
        dir: r.direction as "me" | "they",
        words: r.words,
        made: r.made_on,
        due: r.due_on,
        outcome: r.outcome as Outcome,
        outcomeOn: r.outcome_on,
        source: r.source_id,
      }));
      const evidence = db
        .prepare(
          `SELECT e.concern_id AS concern, e.entry_id AS entry FROM concern_evidence e
           JOIN concerns c ON c.id = e.concern_id WHERE c.owner = ?`,
        )
        .all(owner) as unknown as { concern: string; entry: string }[];
      const evidenceOf = new Map<string, string[]>();
      for (const { concern, entry } of evidence) evidenceOf.set(concern, [...(evidenceOf.get(concern) ?? []), entry]);
      const concerns: Concern[] = (
        db
          .prepare("SELECT * FROM concerns WHERE owner = ? ORDER BY opened_on, id")
          .all(owner) as unknown as ConcernRow[]
      ).map((r) => ({
        id: r.id,
        person: r.person_id,
        text: r.text,
        opened: r.opened_on,
        review: r.review_on,
        state: r.state as ConcernState,
        ev: evidenceOf.get(r.id) ?? [],
        reviewNote: r.review_note,
        reviewed: r.reviewed_on,
      }));
      const corrections = db
        .prepare(
          `SELECT id, person_id AS person, on_date AS "on", text, entry_id AS entry FROM corrections
           WHERE owner = ? ORDER BY on_date, id`,
        )
        .all(owner) as unknown as Correction[];
      const reports: Report[] = (
        db.prepare("SELECT * FROM reports WHERE owner = ? ORDER BY logged_at, id").all(owner) as unknown as ReportRow[]
      ).map((r) => ({
        id: r.id,
        person: r.person_id,
        logged: r.logged_at,
        told: { d: r.told_date, t: r.told_time, p: r.told_prec as Precision },
        hap: { d: r.hap_date, t: r.hap_time, p: r.hap_prec as Precision },
        place: r.place_id,
        text: r.text,
        by: r.told_by,
      }));
      return { care, words, concerns, corrections, reports };
    },

    /** Muninn's !care: Be careful, in the entry's own words. Inside the entry's transaction. */
    addCareFromEntry(owner: string, person: string, entry: string, words: string, since: string): void {
      db.prepare(
        `INSERT INTO care_notes (id, owner, person_id, level, text, since, source_id, confirmed_on)
         VALUES (?, ?, ?, 'careful', ?, ?, ?, ?)`,
      ).run(`care-${entry}`, owner, person, words.slice(0, LIMITS.note), since, entry, since);
    },

    addCare(owner: string, input: unknown): void {
      const body = object(input);
      const id = newId(body.id);
      const person = personField(body.person);
      const level = oneOf(body.level, CARE_LEVELS, "The level");
      const words = required(body.text, LIMITS.note, "The instruction");
      const date = monthDay(body.date);
      const since = day(body.since, "Since");
      const source = optionalId(body.source);
      transaction(db, () => {
        if (alreadySaved("care_notes", owner, id)) return;
        requirePerson(owner, person);
        checkLinked(owner, person, source, "The source");
        db.prepare(
          `INSERT INTO care_notes (id, owner, person_id, level, text, on_date, since, source_id, confirmed_on)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, owner, person, level, words, date, since, source, since);
      });
    },

    changeCare(owner: string, id: string, input: unknown): void {
      const body = object(input);
      transaction(db, () => {
        const row = db.prepare("SELECT * FROM care_notes WHERE id = ? AND owner = ?").get(id, owner) as
          CareRow | undefined;
        if (!row) notFound("care note");
        const level = body.level === undefined ? row.level : oneOf(body.level, CARE_LEVELS, "The level");
        const words = body.text === undefined ? row.text : required(body.text, LIMITS.note, "The instruction");
        const date = body.date === undefined ? row.on_date : monthDay(body.date);
        const source = body.source === undefined ? row.source_id : optionalId(body.source);
        checkLinked(owner, row.person_id, source, "The source");
        const confirmed = body.confirmed === undefined ? row.confirmed_on : day(body.confirmed, "Confirming");
        const retired = body.retired === undefined ? row.retired_on : optionalDay(body.retired, "Retiring");
        db.prepare(
          `UPDATE care_notes SET level = ?, text = ?, on_date = ?, source_id = ?, confirmed_on = ?, retired_on = ?
           WHERE id = ? AND owner = ?`,
        ).run(level, words, date, source, confirmed, retired, id, owner);
      });
    },

    addWord(owner: string, input: unknown): void {
      const body = object(input);
      const id = newId(body.id);
      const person = personField(body.person);
      const dir = oneOf(body.dir, ["me", "they"] as const, "Who gave their word");
      const words = required(body.words, LIMITS.note, "The words");
      const made = day(body.made, "The day it was given");
      const due = optionalDay(body.due, "A due date");
      if (due !== null && due < made) invalid("It can't be due before it was given. Check the dates.");
      const source = optionalId(body.source);
      transaction(db, () => {
        if (alreadySaved("words_given", owner, id)) return;
        requirePerson(owner, person);
        checkLinked(owner, person, source, "The source");
        db.prepare(
          `INSERT INTO words_given (id, owner, person_id, direction, words, made_on, due_on, source_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, owner, person, dir, words, made, due, source);
      });
    },

    /** An outcome is fixed once given. Only a mistaken click can be undone, on the same day. */
    settleWord(owner: string, id: string, input: unknown): void {
      const body = object(input);
      const outcome = oneOf(body.outcome, OUTCOMES, "The outcome");
      const on = day(body.on, "The day of the outcome");
      transaction(db, () => {
        const row = db
          .prepare("SELECT outcome, outcome_on FROM words_given WHERE id = ? AND owner = ?")
          .get(id, owner) as { outcome: string; outcome_on: string | null } | undefined;
        if (!row) notFound("word given");
        if (outcome === "pending") {
          if (row.outcome === "pending") return;
          if (row.outcome_on !== on) conflict("An outcome can only be undone on the day it was given.");
          db.prepare("UPDATE words_given SET outcome = 'pending', outcome_on = NULL WHERE id = ?").run(id);
          return;
        }
        if (row.outcome !== "pending") conflict("This word already has its outcome.");
        db.prepare("UPDATE words_given SET outcome = ?, outcome_on = ? WHERE id = ?").run(outcome, on, id);
      });
    },

    addConcern(owner: string, input: unknown): void {
      const body = object(input);
      const id = newId(body.id);
      const person = personField(body.person);
      const words = required(body.text, LIMITS.note, "The worry");
      const opened = day(body.opened, "The day it was opened");
      const review = day(body.review, "A review");
      if (review <= opened) invalid("Give the concern a review date after the day it is opened.");
      const ev = evidenceList(body.ev ?? []);
      transaction(db, () => {
        if (alreadySaved("concerns", owner, id)) return;
        requirePerson(owner, person);
        for (const entry of ev) checkLinked(owner, person, entry, "Evidence");
        db.prepare(
          "INSERT INTO concerns (id, owner, person_id, text, opened_on, review_on) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(id, owner, person, words, opened, review);
        setEvidence(id, ev);
      });
    },

    changeConcern(owner: string, id: string, input: unknown): void {
      const ev = evidenceList(object(input).ev);
      transaction(db, () => {
        const row = concernRow(owner, id);
        if (row.state !== "open") conflict("This concern has been reviewed, so its evidence stays as it was.");
        for (const entry of ev) checkLinked(owner, row.person_id, entry, "Evidence");
        setEvidence(id, ev);
      });
    },

    reviewConcern(owner: string, id: string, input: unknown): void {
      const body = object(input);
      const state = oneOf(body.state, ["dismissed", "breach"] as const, "The decision");
      const on = day(body.on, "The day of the review");
      const note = required(body.note, LIMITS.note, "The review note");
      transaction(db, () => {
        const row = concernRow(owner, id);
        if (row.state !== "open") conflict("This concern has already been reviewed.");
        if (on < row.review_on) conflict(`Review opens on ${row.review_on}. Until then it stays a concern.`);
        if (state === "breach") {
          const sources = db
            .prepare(
              `SELECT e.source FROM concern_evidence c JOIN entries e ON e.id = c.entry_id WHERE c.concern_id = ?`,
            )
            .all(id) as unknown as { source: Source }[];
          if (!evidenceCanProveBreach(sources.map((s) => s.source))) {
            conflict("A breach needs evidence beyond my own conclusions.");
          }
        }
        db.prepare("UPDATE concerns SET state = ?, review_note = ?, reviewed_on = ? WHERE id = ?").run(
          state,
          note,
          on,
          id,
        );
      });
    },

    addCorrection(owner: string, input: unknown): void {
      const body = object(input);
      const id = newId(body.id);
      const person = personField(body.person);
      const on = day(body.on, "The day");
      const words = required(body.text, LIMITS.note, "The correction");
      const entry = optionalId(body.entry);
      transaction(db, () => {
        if (alreadySaved("corrections", owner, id)) return;
        requirePerson(owner, person);
        checkLinked(owner, person, entry, "The entry");
        db.prepare(
          "INSERT INTO corrections (id, owner, person_id, on_date, text, entry_id) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(id, owner, person, on, words, entry);
      });
    },

    addReport(owner: string, input: unknown): void {
      const body = object(input);
      const person = personField(body.person);
      const report = checkedHearsay(body);
      transaction(db, () => {
        if (alreadySaved("reports", owner, report.id)) return;
        requirePerson(owner, person);
        db.prepare(
          `INSERT INTO reports (id, owner, person_id, logged_at, told_date, told_time, told_prec, hap_date, hap_time,
             hap_prec, place_id, text, told_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          report.id,
          owner,
          person,
          now(),
          report.told.d,
          report.told.t,
          report.told.p,
          report.hap.d,
          report.hap.t,
          report.hap.p,
          placeId(owner, report.place),
          report.text,
          report.by,
        );
      });
    },
  };
}
