// Checking what comes in, before anything is written.
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { LIMITS, QUESTION_KEYS, type Question, type Stamp } from "../shared/protocol.ts";
import { fold, happenedAfterTold, isDate, isStamp } from "../shared/time.ts";
import { StoreError, invalid, notFound, tooMany } from "./errors.ts";

export const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid("That request isn't valid");

/** Text with its spaces trimmed, up to `max` characters. */
export function text(value: unknown, max: number, what: string): string {
  if (typeof value !== "string") invalid(`${what} isn't valid`);
  const trimmed = value.trim();
  if (trimmed.length > max) invalid(`${what} is too long: ${max} characters at most`);
  return trimmed;
}

export function required(value: unknown, max: number, what: string): string {
  return text(value, max, what) || invalid(`${what} can't be empty`);
}

export function list(value: unknown, maxItems: number, maxLength: number, what: string): string[] {
  if (!Array.isArray(value)) invalid(`${what} isn't valid`);
  const items = value.map((item) => text(item, maxLength, what)).filter(Boolean);
  if (items.length > maxItems) invalid(`${what}: ${maxItems} at most`);
  return items;
}

export function oneOf<T extends string>(value: unknown, options: readonly T[], what: string): T {
  return options.includes(value as T) ? (value as T) : invalid(`${what} isn't valid`);
}

export function newId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(value)) invalid("That id isn't valid");
  return value;
}

export function day(value: unknown, what: string): string {
  return isDate(value) ? value : invalid(`${what} needs a full date, like 2026-11-20`);
}

export function stamp(value: unknown, what: string): Stamp {
  return isStamp(value) ? { d: value.d, t: value.t, p: value.p } : invalid(`${what} isn't a valid date`);
}

export const question = (value: unknown): Question => oneOf(value, QUESTION_KEYS, "That question") as Question;

/** An optional id of something in the drawer. */
export const optionalId = (value: unknown): string | null =>
  value === null || value === undefined || value === "" ? null : String(value);

/** A due date or similar, which may be left out. */
export const optionalDay = (value: unknown, what: string): string | null =>
  value === null || value === undefined || value === "" ? null : day(value, what);

export const personField = (value: unknown): string =>
  typeof value === "string" ? value : invalid("Which file isn't valid");

/** What hearsay says: words, who told me, when and where. */
export function checkedHearsay(body: Record<string, unknown>) {
  const told = stamp(body.told, "Told-at");
  const hap = stamp(body.hap, "Happened-at");
  if (happenedAfterTold(hap, told)) invalid("Happened-at is later than told-at. Check the dates.");
  return {
    id: newId(body.id),
    told,
    hap,
    text: required(body.text, LIMITS.body, "What was said"),
    by: text(body.by ?? "", LIMITS.name, "Who told me"),
    place: body.place === null || body.place === undefined ? null : text(body.place, LIMITS.placeLabel, "The place"),
  };
}

export type Checks = ReturnType<typeof createChecks>;

/** The checks that look in the database. */
export function createChecks(db: DatabaseSync) {
  const count = (table: string, owner: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE owner = ?`).get(owner) as { n: number }).n;

  return {
    count,

    requirePerson(owner: string, id: string): void {
      if (!db.prepare("SELECT 1 FROM people WHERE id = ? AND owner = ?").get(id, owner)) notFound("file");
    },

    /** The id of the place with this label, added to the list if it is new. */
    placeId(owner: string, label: string | null): string | null {
      if (!label) return null;
      const key = fold(label);
      const found = db.prepare("SELECT id FROM places WHERE owner = ? AND label_key = ?").get(owner, key) as
        { id: string } | undefined;
      if (found) return found.id;
      if (count("places", owner) >= LIMITS.places) tooMany(`A drawer holds ${LIMITS.places} places at most`);
      const id = randomUUID();
      db.prepare("INSERT INTO places (id, owner, label, label_key) VALUES (?, ?, ?, ?)").run(id, owner, label, key);
      return id;
    },

    /** An entry another record links to must be in the same file. */
    checkLinked(owner: string, person: string, linked: string | null, what: string): void {
      if (linked === null) return;
      const row = db.prepare("SELECT person_id FROM entries WHERE id = ? AND owner = ?").get(linked, owner) as
        { person_id: string } | undefined;
      if (row?.person_id !== person) invalid(`${what} has to be an entry in this file`);
    },

    /** An entry can only be part of an incident its file is in. */
    checkIncident(owner: string, person: string, incident: string | null): void {
      if (incident === null) return;
      const row = db
        .prepare(
          `SELECT 1 FROM incident_people p JOIN incidents i ON i.id = p.incident_id
           WHERE p.incident_id = ? AND p.person_id = ? AND i.owner = ?`,
        )
        .get(incident, person, owner);
      if (!row) invalid("That incident doesn't involve this file");
    },

    /** Whether a request with this id has already been saved: sending one twice saves it once. */
    alreadySaved(table: string, owner: string, id: string): boolean {
      const row = db.prepare(`SELECT owner FROM ${table} WHERE id = ?`).get(id) as { owner: string } | undefined;
      if (!row) return false;
      if (row.owner !== owner) throw new StoreError(409, "That id isn't available", "conflict");
      return true;
    },
  };
}
