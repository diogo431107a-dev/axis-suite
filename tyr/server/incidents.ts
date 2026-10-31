// Incidents: things bigger than one entry. What I saw or was told is an ordinary entry that points
// to its incident; only hearsay is kept in the incident itself. What is known can change, and its
// history stays.
import type { DatabaseSync } from "node:sqlite";
import {
  INCIDENT_STATUSES,
  LIMITS,
  type Hearsay,
  type Incident,
  type IncidentStatus,
  type Precision,
} from "../shared/protocol.ts";
import { checkedHearsay, day, list, newId, object, oneOf, required, text, type Checks } from "./check.ts";
import { invalid, notFound, transaction } from "./errors.ts";

export interface Incidents {
  addIncident(owner: string, input: unknown): void;
  changeIncident(owner: string, id: string, input: unknown): void;
  addIncidentNote(owner: string, id: string, input: unknown): void;
}

interface IncidentRow {
  id: string;
  title: string;
  status: string;
  mentions: string;
  opened_on: string;
  closed_on: string | null;
  close_note: string;
}

interface NoteRow {
  id: string;
  incident_id: string;
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

function peopleList(value: unknown): string[] {
  if (!Array.isArray(value)) invalid("Who is involved isn't valid");
  const people = [...new Set(value.map(String))];
  if (people.length === 0) invalid("An incident involves at least one file");
  return people;
}

export function createIncidents(db: DatabaseSync, checks: Checks, now: () => string) {
  const { alreadySaved, placeId, requirePerson } = checks;

  function incidentRow(owner: string, id: string): IncidentRow {
    const row = db.prepare("SELECT * FROM incidents WHERE id = ? AND owner = ?").get(id, owner) as
      IncidentRow | undefined;
    return row ?? notFound("incident");
  }

  function addStatus(incident: string, on: string, status: IncidentStatus): void {
    db.prepare("INSERT INTO incident_status (incident_id, on_date, status) VALUES (?, ?, ?)").run(incident, on, status);
  }

  function setPeople(owner: string, incident: string, people: string[]): void {
    for (const person of people) requirePerson(owner, person);
    db.prepare("DELETE FROM incident_people WHERE incident_id = ?").run(incident);
    const add = db.prepare("INSERT INTO incident_people (incident_id, person_id) VALUES (?, ?)");
    for (const person of people) add.run(incident, person);
    // An entry can only be part of an incident its file is in.
    db.prepare(
      `UPDATE entries SET incident_id = NULL WHERE incident_id = ? AND person_id NOT IN
         (SELECT person_id FROM incident_people WHERE incident_id = ?)`,
    ).run(incident, incident);
  }

  return {
    loadIncidents(owner: string): Incident[] {
      const rows = db
        .prepare("SELECT * FROM incidents WHERE owner = ? ORDER BY opened_on, id")
        .all(owner) as unknown as IncidentRow[];
      const people = db
        .prepare(
          `SELECT p.incident_id AS incident, p.person_id AS person FROM incident_people p
           JOIN incidents i ON i.id = p.incident_id WHERE i.owner = ?`,
        )
        .all(owner) as unknown as { incident: string; person: string }[];
      const history = db
        .prepare(
          `SELECT s.incident_id AS incident, s.on_date AS "on", s.status FROM incident_status s
           JOIN incidents i ON i.id = s.incident_id WHERE i.owner = ? ORDER BY s.seq`,
        )
        .all(owner) as unknown as { incident: string; on: string; status: IncidentStatus }[];
      const notes = db
        .prepare("SELECT * FROM incident_notes WHERE owner = ? ORDER BY logged_at, id")
        .all(owner) as unknown as NoteRow[];
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status as IncidentStatus,
        people: people.filter((p) => p.incident === r.id).map((p) => p.person),
        mentions: JSON.parse(r.mentions) as string[],
        opened: r.opened_on,
        closed: r.closed_on,
        closeNote: r.close_note,
        history: history.filter((h) => h.incident === r.id).map((h) => ({ on: h.on, status: h.status })),
        notes: notes
          .filter((n) => n.incident_id === r.id)
          .map((n): Hearsay => ({
            id: n.id,
            logged: n.logged_at,
            told: { d: n.told_date, t: n.told_time, p: n.told_prec as Precision },
            hap: { d: n.hap_date, t: n.hap_time, p: n.hap_prec as Precision },
            place: n.place_id,
            text: n.text,
            by: n.told_by,
          })),
      }));
    },

    addIncident(owner: string, input: unknown): void {
      const body = object(input);
      const id = newId(body.id);
      const title = required(body.title, LIMITS.title, "The title");
      const status = oneOf(body.status, INCIDENT_STATUSES, "What is known");
      const opened = day(body.opened, "The day it was opened");
      const people = peopleList(body.people);
      const mentions = list(body.mentions ?? [], LIMITS.mentions, LIMITS.matter, "Mentions");
      transaction(db, () => {
        if (alreadySaved("incidents", owner, id)) return;
        db.prepare(
          "INSERT INTO incidents (id, owner, title, status, mentions, opened_on) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(id, owner, title, status, JSON.stringify(mentions), opened);
        setPeople(owner, id, people);
        addStatus(id, opened, status);
      });
    },

    changeIncident(owner: string, id: string, input: unknown): void {
      const body = object(input);
      transaction(db, () => {
        const row = incidentRow(owner, id);
        const title = body.title === undefined ? row.title : required(body.title, LIMITS.title, "The title");
        const mentions =
          body.mentions === undefined
            ? (JSON.parse(row.mentions) as string[])
            : list(body.mentions, LIMITS.mentions, LIMITS.matter, "Mentions");
        if (body.people !== undefined) setPeople(owner, id, peopleList(body.people));
        let status = row.status;
        if (body.status !== undefined) {
          const change = object(body.status);
          const to = oneOf(change.to, INCIDENT_STATUSES, "What is known");
          if (to !== row.status) {
            addStatus(id, day(change.on, "The day it changed"), to);
            status = to;
          }
        }
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
          "UPDATE incidents SET title = ?, status = ?, mentions = ?, closed_on = ?, close_note = ? WHERE id = ?",
        ).run(title, status, JSON.stringify(mentions), closedOn, closeNote, id);
      });
    },

    addIncidentNote(owner: string, id: string, input: unknown): void {
      const note = checkedHearsay(object(input));
      transaction(db, () => {
        incidentRow(owner, id);
        if (alreadySaved("incident_notes", owner, note.id)) return;
        db.prepare(
          `INSERT INTO incident_notes (id, owner, incident_id, logged_at, told_date, told_time, told_prec, hap_date,
             hap_time, hap_prec, place_id, text, told_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          note.id,
          owner,
          id,
          now(),
          note.told.d,
          note.told.t,
          note.told.p,
          note.hap.d,
          note.hap.t,
          note.hap.p,
          placeId(owner, note.place),
          note.text,
          note.by,
        );
      });
    },
  };
}
