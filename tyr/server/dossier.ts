// A user's drawer: checks everything before it is written, and keeps the rules of the record.
// Entries are added, not overwritten: once finished, what one says can only be amended by another.
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  CERTAINTIES,
  LIMITS,
  SETTINGS,
  SOURCES,
  WORDINGS,
  type Answer,
  type Certainty,
  type Dossier,
  type Entry,
  type EntryFields,
  type EntryFiling,
  type FileChange,
  type NewAnswer,
  type NewPlace,
  type Person,
  type Place,
  type Precision,
  type Question,
  type Setting,
  type Source,
  type Wording,
} from "../shared/protocol.ts";
import { fold, happenedAfterTold, stampKey } from "../shared/time.ts";
import {
  createChecks,
  day,
  list,
  newId,
  object,
  oneOf,
  optionalId,
  personField,
  question,
  required,
  stamp,
  text,
} from "./check.ts";
import { conflict, invalid, notFound, tooMany, transaction } from "./errors.ts";
import { createIncidents, type Incidents } from "./incidents.ts";
import { createTrust, type Trust } from "./trust.ts";

export interface Store extends Trust, Incidents {
  load(owner: string): Dossier;
  openFile(owner: string, input: unknown): void;
  changeFile(owner: string, id: string, input: unknown): void;
  destroyFile(owner: string, id: string): void;
  addEntry(owner: string, input: unknown): void;
  completeEntry(owner: string, id: string, input: unknown): void;
  fileEntry(owner: string, id: string, input: unknown): void;
  discardEntry(owner: string, id: string): void;
  addAnswer(owner: string, input: unknown): void;
  addPlace(owner: string, input: unknown): void;
  changePlace(owner: string, id: string, input: unknown): void;
  removePlace(owner: string, id: string): void;
  removeUnknownOwners(known: ReadonlySet<string>): { owner: string; entries: number }[];
}

function checkedFields(input: Record<string, unknown>): EntryFields {
  const src = oneOf(input.src, SOURCES, "The source");
  const told = stamp(input.told, "Told-at");
  const hap = stamp(input.hap, "Happened-at");
  if (src !== "N" && happenedAfterTold(hap, told)) invalid("Happened-at is later than told-at. Check the dates.");
  const fuInput = input.fu === null || input.fu === undefined ? null : object(input.fu);
  return {
    src,
    told,
    hap,
    place: input.place === null || input.place === undefined ? null : text(input.place, LIMITS.placeLabel, "The place"),
    setting:
      input.setting === null || input.setting === undefined ? null : oneOf(input.setting, SETTINGS, "The setting"),
    wording: oneOf(input.wording, WORDINGS, "The wording"),
    body: required(input.body, LIMITS.body, "The entry"),
    cat: input.cat === null || input.cat === undefined ? null : question(input.cat),
    cert: oneOf(input.cert, CERTAINTIES, "How sure"),
    conf: input.conf === true,
    present: list(input.present ?? [], LIMITS.present, LIMITS.name, "Who else was there"),
    ctx: text(input.ctx ?? "", LIMITS.context, "The occasion"),
    fu: fuInput && {
      date: day(fuInput.date, "A follow-up"),
      note: text(fuInput.note ?? "", LIMITS.note, "The follow-up note"),
    },
    contra: optionalId(input.contra),
    credit: input.credit === true,
    incident: optionalId(input.incident),
  };
}

interface PersonRow {
  id: string;
  no: number;
  name: string;
  aliases: string;
  role: string;
  matters: string;
  opened_on: string;
  closed_on: string | null;
  close_note: string;
}

interface EntryRow {
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
  setting: string | null;
  source: string;
  wording: string;
  body: string;
  category: string | null;
  certainty: string;
  conf: number;
  present: string;
  context: string;
  fu_date: string | null;
  fu_note: string;
  fu_done_on: string | null;
  amends_id: string | null;
  contra_id: string | null;
  incomplete: number;
  credit: number;
  incident_id: string | null;
}

const toPerson = (r: PersonRow): Person => ({
  id: r.id,
  no: r.no,
  name: r.name,
  aliases: JSON.parse(r.aliases) as string[],
  role: r.role,
  matters: JSON.parse(r.matters) as string[],
  opened: r.opened_on,
  closed: r.closed_on,
  closeNote: r.close_note,
});

const toEntry = (r: EntryRow): Entry => ({
  id: r.id,
  person: r.person_id,
  logged: r.logged_at,
  told: { d: r.told_date, t: r.told_time, p: r.told_prec as Precision },
  hap: { d: r.hap_date, t: r.hap_time, p: r.hap_prec as Precision },
  place: r.place_id,
  setting: r.setting as Setting | null,
  src: r.source as Source,
  wording: r.wording as Wording,
  body: r.body,
  cat: r.category as Question | null,
  cert: r.certainty as Certainty,
  conf: r.conf === 1,
  present: JSON.parse(r.present) as string[],
  ctx: r.context,
  fu: r.fu_date === null ? null : { date: r.fu_date, note: r.fu_note, done: r.fu_done_on },
  amends: r.amends_id,
  contra: r.contra_id,
  incomplete: r.incomplete === 1,
  credit: r.credit === 1,
  incident: r.incident_id,
});

/** `now` is the clock behind logged-at; only the example data sets its own. */
export function createStore(db: DatabaseSync, now: () => string = () => new Date().toISOString()): Store {
  const checks = createChecks(db);
  const { alreadySaved, checkIncident, checkLinked, count, placeId } = checks;
  const trust = createTrust(db, checks, now);
  const incidents = createIncidents(db, checks, now);

  function personRow(owner: string, id: string): PersonRow {
    const row = db.prepare("SELECT * FROM people WHERE id = ? AND owner = ?").get(id, owner) as PersonRow | undefined;
    return row ?? notFound("file");
  }

  function entryRow(owner: string, id: string): EntryRow {
    const row = db.prepare("SELECT * FROM entries WHERE id = ? AND owner = ?").get(id, owner) as EntryRow | undefined;
    return row ?? notFound("entry");
  }

  /** Refuses a name or alias that another file already answers to: the drawer must tell them apart. */
  function checkNamesFree(owner: string, names: string[], except: string | null): void {
    const others = db.prepare("SELECT id, name, aliases FROM people WHERE owner = ?").all(owner) as unknown as {
      id: string;
      name: string;
      aliases: string;
    }[];
    const taken = new Set<string>();
    for (const other of others) {
      if (other.id === except) continue;
      taken.add(fold(other.name));
      for (const alias of JSON.parse(other.aliases) as string[]) taken.add(fold(alias));
    }
    for (const name of names) {
      if (taken.has(fold(name))) {
        conflict(`There is already a file for ${name}. Add a second name or nickname to tell them apart.`);
      }
    }
  }

  function insertEntry(
    owner: string,
    person: string,
    id: string,
    fields: EntryFields,
    amends: string | null,
    incomplete: boolean,
  ) {
    if (count("entries", owner) >= LIMITS.entries) tooMany(`A drawer holds ${LIMITS.entries} entries at most`);
    checkLinked(owner, person, amends, "What it amends");
    checkLinked(owner, person, fields.contra, "What it contradicts");
    checkIncident(owner, person, fields.incident);
    db.prepare(
      `INSERT INTO entries (id, owner, person_id, logged_at, told_date, told_time, told_prec, hap_date, hap_time, hap_prec,
         place_id, setting, source, wording, body, category, certainty, conf, present, context, fu_date, fu_note,
         amends_id, contra_id, incomplete, credit, incident_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      owner,
      person,
      now(),
      fields.told.d,
      fields.told.t,
      fields.told.p,
      fields.hap.d,
      fields.hap.t,
      fields.hap.p,
      placeId(owner, fields.place),
      fields.setting,
      fields.src,
      fields.wording,
      fields.body,
      fields.cat,
      fields.cert,
      fields.conf ? 1 : 0,
      JSON.stringify(fields.present),
      fields.ctx,
      fields.fu?.date ?? null,
      fields.fu?.note ?? "",
      amends,
      fields.contra,
      incomplete ? 1 : 0,
      fields.credit ? 1 : 0,
      fields.incident,
    );
  }

  return {
    ...trust,
    ...incidents,

    load(owner) {
      const people = (
        db.prepare("SELECT * FROM people WHERE owner = ? ORDER BY name_key").all(owner) as unknown as PersonRow[]
      ).map(toPerson);
      const places = db
        .prepare("SELECT id, label, city FROM places WHERE owner = ? ORDER BY label_key")
        .all(owner) as unknown as Place[];
      const entries = (
        db.prepare("SELECT * FROM entries WHERE owner = ? ORDER BY logged_at, id").all(owner) as unknown as EntryRow[]
      ).map(toEntry);
      const evidence = db
        .prepare(
          `SELECT e.answer_seq AS seq, e.entry_id AS entry FROM answer_evidence e
           JOIN answers a ON a.seq = e.answer_seq WHERE a.owner = ?`,
        )
        .all(owner) as unknown as { seq: number; entry: string }[];
      const evidenceOf = new Map<number, string[]>();
      for (const { seq, entry } of evidence) evidenceOf.set(seq, [...(evidenceOf.get(seq) ?? []), entry]);
      const rows = db
        .prepare("SELECT seq, id, person_id, question, text, revised_on FROM answers WHERE owner = ? ORDER BY seq")
        .all(owner) as unknown as {
        seq: number;
        id: string;
        person_id: string;
        question: string;
        text: string;
        revised_on: string;
      }[];
      const answers: Answer[] = rows.map((r) => ({
        id: r.id,
        person: r.person_id,
        q: r.question as Question,
        text: r.text,
        ev: evidenceOf.get(r.seq) ?? [],
        revised: r.revised_on,
      }));
      return { people, places, entries, answers, ...trust.loadTrust(owner), incidents: incidents.loadIncidents(owner) };
    },

    openFile(owner, input) {
      const body = object(input);
      const id = newId(body.id);
      const name = required(body.name, LIMITS.name, "The name");
      const role = text(body.role ?? "", LIMITS.role, "How I know them");
      const opened = day(body.opened, "The day the file was opened");
      const first = object(body.entry);
      const entryId = newId(first.id);
      const fields = checkedFields(first);
      transaction(db, () => {
        if (alreadySaved("people", owner, id)) return;
        if (count("people", owner) >= LIMITS.files) tooMany(`A drawer holds ${LIMITS.files} files at most`);
        checkNamesFree(owner, [name], null);
        const at = now();
        db.prepare("INSERT OR IGNORE INTO drawers (owner, next_no, created_at) VALUES (?, 1, ?)").run(owner, at);
        const { next_no: no } = db.prepare("SELECT next_no FROM drawers WHERE owner = ?").get(owner) as {
          next_no: number;
        };
        db.prepare("UPDATE drawers SET next_no = ? WHERE owner = ?").run(no + 1, owner);
        db.prepare(
          `INSERT INTO people (id, owner, no, name, name_key, role, opened_on, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, owner, no, name, fold(name), role, opened, at, at);
        insertEntry(owner, id, entryId, { ...fields, contra: null, incident: null }, null, first.incomplete === true);
      });
    },

    changeFile(owner, id, input) {
      const body = object(input) as FileChange & Record<string, unknown>;
      transaction(db, () => {
        const row = personRow(owner, id);
        const name = body.name === undefined ? row.name : required(body.name, LIMITS.name, "The name");
        const aliases =
          body.aliases === undefined
            ? (JSON.parse(row.aliases) as string[])
            : list(body.aliases, LIMITS.aliases, LIMITS.name, "Other names");
        checkNamesFree(owner, [name, ...aliases], id);
        const role = body.role === undefined ? row.role : text(body.role, LIMITS.role, "How I know them");
        const matters =
          body.matters === undefined
            ? (JSON.parse(row.matters) as string[])
            : list(body.matters, LIMITS.matters, LIMITS.matter, "What matters most");
        let closedOn = row.closed_on;
        let closeNote = row.close_note;
        if (body.closed === null) {
          closedOn = null;
          closeNote = "";
        } else if (body.closed !== undefined) {
          const closed = object(body.closed);
          closedOn = day(closed.on, "Closing");
          closeNote = text(closed.note ?? "", LIMITS.note, "The closing note");
        }
        db.prepare(
          `UPDATE people SET name = ?, name_key = ?, aliases = ?, role = ?, matters = ?, closed_on = ?, close_note = ?,
             updated_at = ? WHERE id = ? AND owner = ?`,
        ).run(
          name,
          fold(name),
          JSON.stringify(aliases),
          role,
          JSON.stringify(matters),
          closedOn,
          closeNote,
          now(),
          id,
          owner,
        );
      });
    },

    destroyFile(owner, id) {
      transaction(db, () => {
        personRow(owner, id);
        // Its entries, answers and evidence go with it. The file's number stays used.
        db.prepare("DELETE FROM people WHERE id = ? AND owner = ?").run(id, owner);
        // An incident with nobody left in it goes too.
        db.prepare("DELETE FROM incidents WHERE owner = ? AND id NOT IN (SELECT incident_id FROM incident_people)").run(
          owner,
        );
      });
    },

    addEntry(owner, input) {
      const body = object(input);
      const id = newId(body.id);
      const person = personField(body.person);
      const fields = checkedFields(body);
      const amends = optionalId(body.amends);
      transaction(db, () => {
        if (alreadySaved("entries", owner, id)) return;
        personRow(owner, person);
        insertEntry(owner, person, id, fields, amends, body.incomplete === true);
        // Muninn's !care: the same words, as an instruction to look at later.
        if (body.care === true) {
          trust.addCareFromEntry(owner, person, id, fields.body, stampKey(fields.told).slice(0, 10));
        }
      });
    },

    completeEntry(owner, id, input) {
      const fields = checkedFields(object(input));
      transaction(db, () => {
        const row = entryRow(owner, id);
        if (row.incomplete !== 1) conflict("This entry is finished. Amend it with a new entry instead.");
        checkLinked(owner, row.person_id, fields.contra, "What it contradicts");
        if (fields.contra === id) invalid("An entry can't contradict itself");
        checkIncident(owner, row.person_id, fields.incident);
        const place = placeId(owner, fields.place);
        db.prepare(
          `UPDATE entries SET told_date = ?, told_time = ?, told_prec = ?, hap_date = ?, hap_time = ?, hap_prec = ?,
             place_id = ?, setting = ?, source = ?, wording = ?, body = ?, category = ?, certainty = ?, conf = ?,
             present = ?, context = ?, fu_date = ?, fu_note = ?, contra_id = ?, incomplete = ?, credit = ?, incident_id = ?
           WHERE id = ? AND owner = ?`,
        ).run(
          fields.told.d,
          fields.told.t,
          fields.told.p,
          fields.hap.d,
          fields.hap.t,
          fields.hap.p,
          place,
          fields.setting,
          fields.src,
          fields.wording,
          fields.body,
          fields.cat,
          fields.cert,
          fields.conf ? 1 : 0,
          JSON.stringify(fields.present),
          fields.ctx,
          fields.fu?.date ?? null,
          fields.fu?.note ?? "",
          fields.contra,
          place && fields.cat ? 0 : 1,
          fields.credit ? 1 : 0,
          fields.incident,
          id,
          owner,
        );
      });
    },

    fileEntry(owner, id, input) {
      const body = object(input) as EntryFiling & Record<string, unknown>;
      transaction(db, () => {
        const row = entryRow(owner, id);
        if (body.cat !== undefined) {
          const cat = body.cat === null ? null : question(body.cat);
          db.prepare("UPDATE entries SET category = ? WHERE id = ? AND owner = ?").run(cat, id, owner);
        }
        if (body.fuDone !== undefined) {
          if (row.fu_date === null) invalid("This entry has no follow-up");
          const done = body.fuDone === null ? null : day(body.fuDone, "The day it was done");
          db.prepare("UPDATE entries SET fu_done_on = ? WHERE id = ? AND owner = ?").run(done, id, owner);
        }
        if (body.credit !== undefined) {
          const credit = body.credit === true ? 1 : 0;
          db.prepare("UPDATE entries SET credit = ? WHERE id = ? AND owner = ?").run(credit, id, owner);
        }
        if (body.incident !== undefined) {
          const incident = optionalId(body.incident);
          checkIncident(owner, row.person_id, incident);
          db.prepare("UPDATE entries SET incident_id = ? WHERE id = ? AND owner = ?").run(incident, id, owner);
        }
      });
    },

    discardEntry(owner, id) {
      transaction(db, () => {
        const row = entryRow(owner, id);
        if (row.incomplete !== 1) conflict("This entry is finished, so it stays. Amend it with a new entry instead.");
        db.prepare("DELETE FROM entries WHERE id = ? AND owner = ?").run(id, owner);
      });
    },

    addAnswer(owner, input) {
      const body = object(input) as Partial<NewAnswer> & Record<string, unknown>;
      const id = newId(body.id);
      const person = personField(body.person);
      const q = question(body.q);
      const answer = required(body.text, LIMITS.answer, "The answer");
      const revised = day(body.revised, "The day it was revised");
      if (!Array.isArray(body.ev) || body.ev.length > LIMITS.evidence) invalid("The evidence isn't valid");
      const evidence = [...new Set(body.ev.map(String))];
      transaction(db, () => {
        if (alreadySaved("answers", owner, id)) return;
        personRow(owner, person);
        for (const entry of evidence) checkLinked(owner, person, entry, "Evidence");
        const { lastInsertRowid: seq } = db
          .prepare(
            `INSERT INTO answers (id, owner, person_id, question, text, revised_on, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(id, owner, person, q, answer, revised, now());
        const link = db.prepare("INSERT INTO answer_evidence (answer_seq, entry_id) VALUES (?, ?)");
        for (const entry of evidence) link.run(seq, entry);
      });
    },

    addPlace(owner, input) {
      const body = object(input) as Partial<NewPlace> & Record<string, unknown>;
      const label = required(body.label, LIMITS.placeLabel, "The label");
      const city = text(body.city ?? "", LIMITS.city, "The city");
      transaction(db, () => {
        if (count("places", owner) >= LIMITS.places) tooMany(`A drawer holds ${LIMITS.places} places at most`);
        const taken = db.prepare("SELECT 1 FROM places WHERE owner = ? AND label_key = ?").get(owner, fold(label));
        if (taken) conflict("That place is already on the list.");
        db.prepare("INSERT INTO places (id, owner, label, label_key, city) VALUES (?, ?, ?, ?, ?)").run(
          randomUUID(),
          owner,
          label,
          fold(label),
          city,
        );
      });
    },

    changePlace(owner, id, input) {
      const body = object(input);
      const label = required(body.label, LIMITS.placeLabel, "The label");
      const city = text(body.city ?? "", LIMITS.city, "The city");
      transaction(db, () => {
        const taken = db
          .prepare("SELECT 1 FROM places WHERE owner = ? AND label_key = ? AND id <> ?")
          .get(owner, fold(label), id);
        if (taken) conflict("That place is already on the list.");
        const { changes } = db
          .prepare("UPDATE places SET label = ?, label_key = ?, city = ? WHERE id = ? AND owner = ?")
          .run(label, fold(label), city, id, owner);
        if (changes === 0) notFound("place");
      });
    },

    removePlace(owner, id) {
      transaction(db, () => {
        for (const table of ["entries", "incident_notes", "reports"]) {
          const used = db.prepare(`SELECT 1 FROM ${table} WHERE owner = ? AND place_id = ? LIMIT 1`).get(owner, id);
          if (used) conflict("Things were logged at this place, so it stays on the list.");
        }
        const { changes } = db.prepare("DELETE FROM places WHERE id = ? AND owner = ?").run(id, owner);
        if (changes === 0) notFound("place");
      });
    },

    removeUnknownOwners(known) {
      const owners = db.prepare("SELECT owner FROM drawers UNION SELECT owner FROM places").all() as unknown as {
        owner: string;
      }[];
      const removed: { owner: string; entries: number }[] = [];
      for (const { owner } of owners) {
        if (known.has(owner)) continue;
        transaction(db, () => {
          const entries = count("entries", owner);
          db.prepare("DELETE FROM people WHERE owner = ?").run(owner);
          db.prepare("DELETE FROM incidents WHERE owner = ?").run(owner);
          db.prepare("DELETE FROM places WHERE owner = ?").run(owner);
          db.prepare("DELETE FROM drawers WHERE owner = ?").run(owner);
          removed.push({ owner, entries });
        });
      }
      return removed;
    },
  };
}
