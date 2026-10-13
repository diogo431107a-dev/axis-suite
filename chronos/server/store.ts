import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { daysBetween, isDate } from "../shared/dates.ts";
import {
  COLORS,
  DEFAULT_SETTINGS,
  LIMITS,
  type CalEvent,
  type Calendar,
  type Color,
  type ErrorCode,
  type EventSaved,
  type ExportCalendar,
  type ExportFile,
  type ImportEvent,
  type ImportResult,
  type Permission,
  type RestoreResult,
  type Role,
  type Settings,
  type Share,
} from "../shared/protocol.ts";
import { dayStart, isInstant, isZone, zoneName } from "../shared/zones.ts";

// The only place calendars and events are read and written, so this is the one place that decides
// who may see or change a calendar: its owner (a Heimdall username), and the people it is shared
// with. A calendar the user can't see, and its events, answer exactly like ones that don't exist;
// one they may only read answers 403 to a change.

/** A request the store refuses, with the HTTP status to answer. */
export class StoreError extends Error {
  readonly status: number;
  readonly code: ErrorCode | undefined;
  /** with "conflict": the event as it is now */
  readonly event: CalEvent | undefined;
  constructor(status: number, message: string, code?: ErrorCode, event?: CalEvent) {
    super(message);
    this.status = status;
    this.code = code;
    this.event = event;
  }
}

/** A calendar as the signed-in user sees it: colour and visibility are their own. */
interface CalendarRow {
  id: string;
  owner: string;
  name: string;
  color: Color;
  visible: number;
  position: number;
  source_name: string | null;
  imported_at: string | null;
  events: number;
  /** the signed-in user's permission, if the calendar is shared with them */
  shared_as: Permission | null;
  /** shared with anyone at all */
  shared: number;
}

interface EventRow {
  id: string;
  owner: string;
  calendar_id: string;
  uid: string;
  recurrence_id: string;
  origin: "user" | "import";
  title: string;
  all_day: number;
  start_at: string | null;
  end_at: string | null;
  start_date: string | null;
  end_date: string | null;
  source_zone: string | null;
  location: string;
  description: string;
  url: string;
  rev: number;
  created_at: string;
  updated_at: string;
}

/** What an event holds apart from its calendar and identity: what an import compares. */
type Content = Omit<ImportEvent, "uid" | "recurrenceId">;

function invalid(message: string): never {
  throw new StoreError(400, message, "invalid");
}

const notFound = (what: string): never => {
  throw new StoreError(404, `No such ${what}`, "not-found");
};

function forbidden(message: string): never {
  throw new StoreError(403, message, "forbidden");
}

/** The user's role on a calendar they can see. */
const roleOf = (row: CalendarRow, user: string): Role =>
  row.owner === user ? "owner" : row.shared_as === "write" ? "editor" : "viewer";

export const canEdit = (role: Role) => role !== "viewer";

function objectBody(input: unknown, what = "The request body"): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) invalid(`${what} must be a JSON object`);
  return input as Record<string, unknown>;
}

/** A text field; missing is empty. Single-line fields are trimmed. */
function text(value: unknown, name: string, max: number, trim = true): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") invalid(`${name} must be text`);
  const s = trim ? value.trim() : value.trimEnd();
  if (s.length > max) invalid(`${name} is longer than ${max} characters`);
  return s;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], name: string): T {
  if (!options.includes(value as T)) invalid(`${name} must be one of ${options.join(", ")}`);
  return value as T;
}

function webUrl(value: unknown): string {
  let url = text(value, "The link", LIMITS.urlChars);
  if (!url) return "";
  // "example.com" is meant as a web address.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") return url;
  } catch {
    // below
  }
  return invalid("Only http:// and https:// links can be kept");
}

/** An event's contents from a request, checked: the title, when, where, what. */
function contentOf(b: Record<string, unknown>): Omit<Content, "sourceZone"> {
  const title = text(b.title, "The title", LIMITS.titleChars);
  if (!title) invalid("An event needs a title");
  if (typeof b.allDay !== "boolean") invalid("allDay must be true or false");
  const { start, end } = b;
  if (b.allDay) {
    if (!isDate(start) || !isDate(end)) invalid("An all-day event starts and ends on dates, YYYY-MM-DD");
    if (end <= start) invalid("An all-day event ends after the day it starts (the end is the day after its last)");
  } else {
    if (!isInstant(start) || !isInstant(end)) invalid("An event starts and ends at times in UTC, YYYY-MM-DDTHH:MM:SSZ");
    if (end < start) invalid("An event can't end before it starts");
  }
  return {
    title,
    allDay: b.allDay,
    start,
    end,
    location: text(b.location, "The location", LIMITS.locationChars),
    description: text(b.description, "The description", LIMITS.descriptionChars, false),
    url: webUrl(b.url),
  };
}

/** An event read from a file or a backup, checked. */
function importEventOf(input: unknown): ImportEvent {
  const b = objectBody(input);
  const uid = text(b.uid, "The UID", 1000);
  if (!uid) invalid("An event needs a UID");
  const recurrenceId = text(b.recurrenceId, "The recurrence id", 40);
  if (recurrenceId && !isDate(recurrenceId) && !isInstant(recurrenceId)) {
    invalid("The recurrence id must be a date or an instant");
  }
  let sourceZone: string | null = null;
  if (b.sourceZone !== undefined && b.sourceZone !== null && b.sourceZone !== "") {
    if (!isZone(b.sourceZone)) invalid(`${String(b.sourceZone)} isn't a time zone`);
    sourceZone = zoneName(b.sourceZone);
  }
  const content = contentOf(b);
  return { uid, recurrenceId, ...content, sourceZone: content.allDay ? null : sourceZone };
}

function calendarName(value: unknown): string {
  const name = text(value, "The calendar's name", LIMITS.calendarNameChars);
  if (!name) invalid("The calendar's name is empty");
  return name;
}

/** Names compare without case: "Work" and "work" are the same calendar. */
const nameKey = (name: string) => name.normalize("NFC").toLowerCase();

function settingsValue(input: unknown): Settings {
  const b = objectBody(input);
  const homeZone = b.homeZone ?? DEFAULT_SETTINGS.homeZone;
  if (homeZone !== "" && !isZone(homeZone)) invalid(`${String(homeZone)} isn't a time zone`);
  if (typeof homeZone === "string" && homeZone.startsWith("UTC") && homeZone !== "UTC") {
    invalid("The home zone must be a named time zone, such as America/Sao_Paulo");
  }
  const defaultCalendarId = b.defaultCalendarId ?? null;
  if (defaultCalendarId !== null && typeof defaultCalendarId !== "string") invalid("defaultCalendarId must be an id");
  const defaultDuration = b.defaultDuration ?? DEFAULT_SETTINGS.defaultDuration;
  if (!Number.isInteger(defaultDuration) || (defaultDuration as number) < 5 || (defaultDuration as number) > 24 * 60) {
    invalid("The default duration must be 5 to 1440 minutes");
  }
  return {
    homeZone: homeZone === "" ? "" : zoneName(homeZone as string)!,
    defaultCalendarId,
    defaultDuration: defaultDuration as number,
  };
}

const sameContent = (a: Content, b: Content) =>
  a.title === b.title &&
  a.allDay === b.allDay &&
  a.start === b.start &&
  a.end === b.end &&
  a.sourceZone === b.sourceZone &&
  a.location === b.location &&
  a.description === b.description &&
  a.url === b.url;

const eventKey = (uid: string, recurrenceId: string) => `${uid}\n${recurrenceId}`;

export function createStore(db: DatabaseSync) {
  // The user's own calendars, then those shared with them (by owner, then name). For a calendar
  // shared with them, the colour and whether it is shown are theirs.
  const selectCalendars = db.prepare(
    `SELECT c.id, c.owner, c.name, coalesce(s.color, c.color) AS color, coalesce(s.visible, c.visible) AS visible,
       c.position, c.source_name, c.imported_at, (SELECT count(*) FROM events e WHERE e.calendar_id = c.id) AS events,
       s.permission AS shared_as, EXISTS (SELECT 1 FROM calendar_shares x WHERE x.calendar_id = c.id) AS shared
     FROM calendars c LEFT JOIN calendar_shares s ON s.calendar_id = c.id AND s.username = $user
     WHERE c.owner = $user OR s.permission IS NOT NULL
     ORDER BY c.owner <> $user, c.owner, CASE WHEN c.owner = $user THEN c.position END, lower(c.name), c.created_at, c.id`,
  );
  const insertCalendar = db.prepare(
    `INSERT INTO calendars (id, owner, name, color, visible, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, (SELECT coalesce(max(position), 0) + 1 FROM calendars WHERE owner = ?), ?, ?)`,
  );
  const updateCalendarRow = db.prepare(
    "UPDATE calendars SET name = ?, color = ?, visible = ?, updated_at = ? WHERE id = ?",
  );
  const updateShareView = db.prepare(
    "UPDATE calendar_shares SET color = ?, visible = ? WHERE calendar_id = ? AND username = ?",
  );
  const markImported = db.prepare("UPDATE calendars SET source_name = ?, imported_at = ?, updated_at = ? WHERE id = ?");
  const deleteCalendarRow = db.prepare("DELETE FROM calendars WHERE id = ?");

  const selectShares = db.prepare(
    "SELECT username, permission FROM calendar_shares WHERE calendar_id = ? ORDER BY username",
  );
  const insertShare = db.prepare(
    "INSERT INTO calendar_shares (calendar_id, username, permission, color, visible) VALUES (?, ?, ?, ?, 1)",
  );
  const updateSharePermission = db.prepare(
    "UPDATE calendar_shares SET permission = ? WHERE calendar_id = ? AND username = ?",
  );
  const deleteShare = db.prepare("DELETE FROM calendar_shares WHERE calendar_id = ? AND username = ?");

  const selectEvent = db.prepare("SELECT * FROM events WHERE id = ?");
  // Timed events that overlap [from, to) (one with no length counts at its start), and all-day
  // events on any day from `fromDate` up to, not including, `toDate`.
  const selectRange = db.prepare(
    `SELECT * FROM events WHERE calendar_id IN (
       SELECT id FROM calendars WHERE owner = $user UNION SELECT calendar_id FROM calendar_shares WHERE username = $user
     ) AND (
       (all_day = 0 AND start_at < $to AND (end_at > $from OR start_at >= $from))
       OR (all_day = 1 AND start_date < $toDate AND end_date > $fromDate))
     ORDER BY coalesce(start_date, start_at), id`,
  );
  const selectCalendarEvents = db.prepare(
    "SELECT * FROM events WHERE calendar_id = ? ORDER BY coalesce(start_date, start_at), id",
  );
  const countEvents = db.prepare("SELECT count(*) AS n FROM events WHERE owner = ?");
  const insertEvent = db.prepare(
    `INSERT INTO events (id, owner, calendar_id, uid, recurrence_id, origin, title, all_day, start_at, end_at,
       start_date, end_date, source_zone, location, description, url, rev, created_at, updated_at)
     VALUES ($id, $owner, $calendar_id, $uid, $recurrence_id, $origin, $title, $all_day, $start_at, $end_at,
       $start_date, $end_date, $source_zone, $location, $description, $url, $rev, $created_at, $updated_at)`,
  );
  // An event belongs to its calendar's owner, so moving it to someone else's calendar gives it to them.
  const updateEvent = db.prepare(
    `UPDATE events SET owner = $owner, calendar_id = $calendar_id, title = $title, all_day = $all_day, start_at = $start_at,
       end_at = $end_at, start_date = $start_date, end_date = $end_date, source_zone = $source_zone,
       location = $location, description = $description, url = $url, rev = $rev, updated_at = $updated_at
     WHERE id = $id`,
  );
  const deleteEventRow = db.prepare("DELETE FROM events WHERE id = ?");
  const nextRev = db.prepare("UPDATE meta SET value = value + 1 WHERE key = 'rev' RETURNING value");

  const selectSettings = db.prepare("SELECT data FROM settings WHERE owner = ?");
  const upsertSettings = db.prepare(
    "INSERT INTO settings (owner, data) VALUES (?, ?) ON CONFLICT (owner) DO UPDATE SET data = excluded.data",
  );

  // $known: a JSON array of usernames.
  const UNKNOWN_OWNER = "owner NOT IN (SELECT value FROM json_each($known))";
  const countUnknownOwners = db.prepare(`
    SELECT owner, sum(event) AS events FROM (
      SELECT owner, 1 AS event FROM events WHERE ${UNKNOWN_OWNER}
      UNION ALL SELECT owner, 0 FROM calendars WHERE ${UNKNOWN_OWNER}
      UNION ALL SELECT owner, 0 FROM settings WHERE ${UNKNOWN_OWNER}
    ) GROUP BY owner ORDER BY owner`);
  // Calendars take their events and shares with them; then nothing stays shared with those users.
  const deleteUnknown = [
    ...["calendars", "settings"].map((table) => db.prepare(`DELETE FROM ${table} WHERE ${UNKNOWN_OWNER}`)),
    db.prepare("DELETE FROM calendar_shares WHERE username NOT IN (SELECT value FROM json_each($known))"),
  ];

  /** Runs `fn` in one transaction. */
  function transaction<T>(fn: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  const listShares = (calendarId: string) => selectShares.all(calendarId) as unknown as Share[];

  const toCalendar = (row: CalendarRow, user: string): Calendar => ({
    id: row.id,
    owner: row.owner,
    role: roleOf(row, user),
    shared: Boolean(row.shared),
    ...(row.owner === user && { shares: listShares(row.id) }),
    name: row.name,
    color: row.color,
    visible: row.visible === 1,
    position: row.position,
    sourceName: row.source_name,
    importedAt: row.imported_at,
    events: row.events,
  });

  const toEvent = (row: EventRow): CalEvent => ({
    id: row.id,
    calendarId: row.calendar_id,
    uid: row.uid,
    recurrenceId: row.recurrence_id,
    origin: row.origin,
    title: row.title,
    allDay: row.all_day === 1,
    start: (row.all_day ? row.start_date : row.start_at)!,
    end: (row.all_day ? row.end_date : row.end_at)!,
    sourceZone: row.source_zone,
    location: row.location,
    description: row.description,
    url: row.url,
    rev: row.rev,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  const contentFrom = (e: CalEvent): Content => ({
    title: e.title,
    allDay: e.allDay,
    start: e.start,
    end: e.end,
    sourceZone: e.sourceZone,
    location: e.location,
    description: e.description,
    url: e.url,
  });

  /** Every calendar the user can see: their own, then those shared with them. */
  const calendarRows = (user: string) => selectCalendars.all({ $user: user }) as unknown as CalendarRow[];
  /** The user's own calendars. */
  const ownRows = (user: string) => calendarRows(user).filter((c) => c.owner === user);

  /** A calendar the user can see. */
  function calendarRow(user: string, id: unknown): CalendarRow {
    return calendarRows(user).find((c) => c.id === id) ?? notFound("calendar");
  }

  /** A calendar the user can see and change the events of. */
  function writableRow(user: string, id: unknown): CalendarRow {
    const row = calendarRow(user, id);
    if (!canEdit(roleOf(row, user))) forbidden(`You can only read the calendar ${row.name}`);
    return row;
  }

  /** A calendar of the user's own; `message` is the refusal for one shared with them. */
  function ownedRow(user: string, id: unknown, message: string): CalendarRow {
    const row = calendarRow(user, id);
    if (row.owner !== user) forbidden(message);
    return row;
  }

  /** An event of a calendar the user can see, with that calendar. */
  function eventRow(user: string, id: string): { row: EventRow; calendar: CalendarRow } {
    const row = (selectEvent.get(id) as EventRow | undefined) ?? notFound("event");
    const calendar = calendarRows(user).find((c) => c.id === row.calendar_id) ?? notFound("event");
    return { row, calendar };
  }

  function checkNameFree(owner: string, name: string, exceptId?: string): void {
    const clash = ownRows(owner).find((c) => c.id !== exceptId && nameKey(c.name) === nameKey(name));
    if (clash) throw new StoreError(409, `There is already a calendar called ${clash.name}`, "exists");
  }

  function addCalendar(owner: string, fields: { name: string; color: Color; visible: boolean }): string {
    if (ownRows(owner).length >= LIMITS.calendars) {
      throw new StoreError(409, `At most ${LIMITS.calendars} calendars`, "too-many");
    }
    checkNameFree(owner, fields.name);
    const id = randomUUID();
    const now = new Date().toISOString();
    insertCalendar.run(id, owner, fields.name, fields.color, fields.visible ? 1 : 0, owner, now, now);
    return id;
  }

  /** A colour none of the user's calendars (their own and shared ones) has yet, if there is one. */
  const freeColor = (user: string): Color => {
    const used = new Set(calendarRows(user).map((c) => c.color));
    return COLORS.find((c) => !used.has(c)) ?? COLORS[0];
  };

  /** A name like `name` that no calendar has yet: "Holidays", "Holidays (2)", … */
  function freeName(owner: string, name: string): string {
    const taken = new Set(ownRows(owner).map((c) => nameKey(c.name)));
    let candidate = name;
    for (let n = 2; taken.has(nameKey(candidate)); n++) {
      const suffix = ` (${n})`;
      candidate = name.slice(0, LIMITS.calendarNameChars - suffix.length) + suffix;
    }
    return candidate;
  }

  function checkRoom(owner: string): void {
    const { n } = countEvents.get(owner) as { n: number };
    if (n > LIMITS.events) throw new StoreError(409, `At most ${LIMITS.events} events`, "too-many");
  }

  const newRev = () => (nextRev.get() as { value: number }).value;

  const timeColumns = (c: Omit<Content, "sourceZone">) => ({
    $all_day: c.allDay ? 1 : 0,
    $start_at: c.allDay ? null : c.start,
    $end_at: c.allDay ? null : c.end,
    $start_date: c.allDay ? c.start : null,
    $end_date: c.allDay ? c.end : null,
  });

  /** `owner`: the owner of the calendar it goes into. */
  function insert(
    owner: string,
    calendarId: string,
    e: ImportEvent,
    origin: "user" | "import",
    now = new Date().toISOString(),
  ): EventSaved {
    const id = randomUUID();
    const rev = newRev();
    insertEvent.run({
      $id: id,
      $owner: owner,
      $calendar_id: calendarId,
      $uid: e.uid,
      $recurrence_id: e.recurrenceId,
      $origin: origin,
      $title: e.title,
      ...timeColumns(e),
      $source_zone: e.sourceZone,
      $location: e.location,
      $description: e.description,
      $url: e.url,
      $rev: rev,
      $created_at: now,
      $updated_at: now,
    });
    return { id, rev, updatedAt: now };
  }

  /** `owner`: the owner of the calendar the event is (now) in. */
  function update(owner: string, id: string, calendarId: string, c: Content): EventSaved {
    const rev = newRev();
    const now = new Date().toISOString();
    updateEvent.run({
      $id: id,
      $owner: owner,
      $calendar_id: calendarId,
      $title: c.title,
      ...timeColumns(c),
      $source_zone: c.sourceZone,
      $location: c.location,
      $description: c.description,
      $url: c.url,
      $rev: rev,
      $updated_at: now,
    });
    return { id, rev, updatedAt: now };
  }

  function getSettings(owner: string): Settings {
    const row = selectSettings.get(owner) as { data: string } | undefined;
    return row ? { ...DEFAULT_SETTINGS, ...(JSON.parse(row.data) as Partial<Settings>) } : DEFAULT_SETTINGS;
  }

  /**
   * Puts a file's events into a calendar. An event matches one there by UID and recurrence id:
   * if anything differs it is updated, else left alone; one that matches nothing is added. With
   * `removeMissing`, the calendar's imported events that aren't in the file go (events made here
   * stay). `owner` is the calendar's. Runs inside the caller's transaction.
   */
  function merge(
    owner: string,
    calendarId: string,
    events: (ImportEvent & { origin?: "user" | "import" })[],
    removeMissing: boolean,
  ) {
    const result = { added: 0, updated: 0, unchanged: 0, removed: 0 };
    const here = new Map(
      (selectCalendarEvents.all(calendarId) as unknown as EventRow[]).map((row) => [
        eventKey(row.uid, row.recurrence_id),
        toEvent(row),
      ]),
    );
    const inFile = new Set<string>();
    for (const e of events) {
      const key = eventKey(e.uid, e.recurrenceId);
      // The same event twice in one file: the last one wins.
      inFile.add(key);
      const match = here.get(key);
      const { uid: _uid, recurrenceId: _rid, origin, ...content } = e;
      if (!match) {
        const saved = insert(owner, calendarId, e, origin ?? "import");
        here.set(key, { ...e, ...saved, calendarId, origin: origin ?? "import", createdAt: saved.updatedAt });
        result.added++;
      } else if (sameContent(contentFrom(match), content)) {
        result.unchanged++;
      } else {
        Object.assign(match, content, update(owner, match.id, calendarId, content));
        result.updated++;
      }
    }
    if (removeMissing) {
      for (const [key, e] of here) {
        if (e.origin === "import" && !inFile.has(key)) {
          deleteEventRow.run(e.id);
          result.removed++;
        }
      }
    }
    return result;
  }

  return {
    // ── Calendars ─────────────────────────────────────────────────────────────────────────────

    /** The user's own calendars, then those shared with them. */
    calendars(user: string): Calendar[] {
      return calendarRows(user).map((row) => toCalendar(row, user));
    },

    createCalendar(user: string, input: unknown): Calendar {
      const b = objectBody(input);
      const name = calendarName(b.name);
      const color = b.color === undefined ? freeColor(user) : oneOf(b.color, COLORS, "The colour");
      const id = transaction(() => addCalendar(user, { name, color, visible: b.visible !== false }));
      return toCalendar(calendarRow(user, id), user);
    },

    /**
     * The owner changes the calendar's name, colour and visibility. Someone it is shared with
     * changes only its colour and visibility for themselves; its name is the owner's to change.
     */
    updateCalendar(user: string, id: string, input: unknown): Calendar {
      const b = objectBody(input);
      return transaction(() => {
        const row = calendarRow(user, id);
        const name = b.name === undefined ? row.name : calendarName(b.name);
        const color = b.color === undefined ? row.color : oneOf(b.color, COLORS, "The colour");
        if (b.visible !== undefined && typeof b.visible !== "boolean") invalid("visible must be true or false");
        const visible = b.visible === undefined ? row.visible === 1 : b.visible;
        if (row.owner === user) {
          checkNameFree(user, name, id);
          updateCalendarRow.run(name, color, visible ? 1 : 0, new Date().toISOString(), id);
        } else {
          if (name !== row.name) forbidden("Only the owner can rename this calendar");
          updateShareView.run(color, visible ? 1 : 0, id, user);
        }
        return toCalendar(calendarRow(user, id), user);
      });
    },

    /** Deletes a calendar and every event in it. Only its owner can. */
    deleteCalendar(user: string, id: string): void {
      ownedRow(user, id, "Only the owner can delete this calendar");
      deleteCalendarRow.run(id);
    },

    /** Every event of one calendar, for writing it as an .ics file. */
    calendarEvents(user: string, id: string): CalEvent[] {
      calendarRow(user, id);
      return (selectCalendarEvents.all(id) as unknown as EventRow[]).map(toEvent);
    },

    // ── Sharing ───────────────────────────────────────────────────────────────────────────────

    /**
     * Replaces everyone the calendar is shared with: `[{ username, permission }]`. Only its owner
     * can; `known` are the usernames it can be shared with (Heimdall's). People who stay keep their
     * colour and visibility; someone new gets a colour none of their calendars has yet.
     */
    setShares(user: string, id: string, input: unknown, known: ReadonlySet<string> | null): Share[] {
      if (!known) invalid("Chronos doesn't know the suite's users, so it can't share calendars");
      if (!Array.isArray(input)) invalid("Expected a list of { username, permission }");
      const shares = new Map<string, Permission>();
      for (const item of input as unknown[]) {
        const { username, permission } = (item ?? {}) as Partial<Record<keyof Share, unknown>>;
        if (typeof username !== "string" || !known.has(username)) invalid(`Not a user: ${String(username)}`);
        if (username === user) invalid("A calendar can't be shared with its owner");
        if (shares.has(username)) invalid(`Listed twice: ${username}`);
        shares.set(username, oneOf(permission, ["read", "write"] as const, "permission"));
      }
      return transaction(() => {
        ownedRow(user, id, "Only the owner can share this calendar");
        const before = new Map(listShares(id).map((s) => [s.username, s.permission]));
        for (const username of before.keys()) if (!shares.has(username)) deleteShare.run(id, username);
        for (const [username, permission] of shares) {
          if (!before.has(username)) insertShare.run(id, username, permission, freeColor(username));
          else if (before.get(username) !== permission) updateSharePermission.run(permission, id, username);
        }
        return listShares(id);
      });
    },

    /** Stops sharing the calendar with one person. The owner can remove anyone; anyone can remove themselves. */
    removeShare(user: string, id: string, username: string): void {
      const row = calendarRow(user, id);
      if (row.owner !== user && username !== user) forbidden("Only the owner can change who sees this calendar");
      if (deleteShare.run(id, username).changes === 0) {
        throw new StoreError(404, "The calendar isn't shared with them", "not-found");
      }
    },

    // ── Events ────────────────────────────────────────────────────────────────────────────────

    /**
     * The events of every calendar the user can see on the days `from` up to, not including, `to`
     * (YYYY-MM-DD), the days as they are in the user's home zone. Hidden calendars' events are
     * included: the page leaves them out.
     */
    events(user: string, query: Record<string, unknown>): CalEvent[] {
      const { from, to } = query;
      if (!isDate(from) || !isDate(to)) invalid("from and to must be dates, YYYY-MM-DD");
      const days = daysBetween(from, to);
      if (days < 1 || days > LIMITS.rangeDays) invalid(`from to to must be 1 to ${LIMITS.rangeDays} days`);
      const zone = getSettings(user).homeZone || "UTC";
      const rows = selectRange.all({
        $user: user,
        $from: dayStart(from, zone),
        $to: dayStart(to, zone),
        $fromDate: from,
        $toDate: to,
      }) as unknown as EventRow[];
      return rows.map(toEvent);
    },

    event(user: string, id: string): CalEvent {
      return toEvent(eventRow(user, id).row);
    },

    createEvent(user: string, input: unknown): EventSaved {
      const b = objectBody(input);
      const content = contentOf(b);
      return transaction(() => {
        const calendar = writableRow(user, b.calendarId);
        const saved = insert(
          calendar.owner,
          calendar.id,
          { uid: `${randomUUID()}@chronos`, recurrenceId: "", ...content, sourceZone: null },
          "user",
        );
        checkRoom(calendar.owner);
        return saved;
      });
    },

    /**
     * Saves an event the editor changed; 409 with the event as it is now if it was saved elsewhere
     * (by anyone) since. Moving it to another calendar needs the right to change both.
     */
    putEvent(user: string, id: string, input: unknown): EventSaved {
      const b = objectBody(input);
      if (!Number.isInteger(b.rev)) invalid("rev is missing: the revision the change was made from");
      const content = contentOf(b);
      return transaction(() => {
        const { row, calendar: from } = eventRow(user, id);
        writableRow(user, from.id);
        const current = toEvent(row);
        if (current.rev !== b.rev) {
          throw new StoreError(409, "This event was changed elsewhere", "conflict", current);
        }
        const to = writableRow(user, b.calendarId);
        // A file's zone means nothing once the times are changed here.
        const moved =
          content.allDay !== current.allDay || content.start !== current.start || content.end !== current.end;
        const saved = update(to.owner, id, to.id, { ...content, sourceZone: moved ? null : current.sourceZone });
        if (to.owner !== from.owner) checkRoom(to.owner);
        return saved;
      });
    },

    deleteEvent(user: string, id: string): void {
      const { calendar } = eventRow(user, id);
      writableRow(user, calendar.id);
      deleteEventRow.run(id);
    },

    // ── Settings ──────────────────────────────────────────────────────────────────────────────

    settings(user: string): Settings {
      return getSettings(user);
    },

    putSettings(user: string, input: unknown): Settings {
      const settings = settingsValue(input);
      // New events go into it, so it must be one the user can add events to.
      if (settings.defaultCalendarId !== null) writableRow(user, settings.defaultCalendarId);
      upsertSettings.run(user, JSON.stringify(settings));
      return settings;
    },

    // ── Import, export, users ─────────────────────────────────────────────────────────────────

    /**
     * Imports a file's events (read by the page) into a calendar, existing (one the user can change
     * the events of) or new (their own; see merge). Everything is checked before anything is
     * written: a bad file changes nothing.
     */
    importEvents(user: string, input: unknown): ImportResult {
      const b = objectBody(input);
      if (!Array.isArray(b.events)) invalid("events must be a list");
      if (b.events.length > LIMITS.importEvents)
        invalid(`At most ${LIMITS.importEvents} events can be imported at once`);
      const events = b.events.map((value, i) => {
        try {
          return importEventOf(value);
        } catch (err) {
          if (err instanceof StoreError) invalid(`Event ${i + 1}: ${err.message}`);
          throw err;
        }
      });
      const sourceName = text(b.sourceName, "The file name", 255);
      const removeMissing = b.removeMissing === true;
      let fresh: { name: string; color: Color | null } | null = null;
      if (b.calendarId === undefined) {
        const n = objectBody(b.newCalendar, "newCalendar");
        fresh = {
          name: calendarName(n.name),
          color: n.color === undefined ? null : oneOf(n.color, COLORS, "The colour"),
        };
      }
      return transaction(() => {
        const target = fresh
          ? {
              id: addCalendar(user, {
                name: freeName(user, fresh.name),
                color: fresh.color ?? freeColor(user),
                visible: true,
              }),
              owner: user,
            }
          : writableRow(user, b.calendarId);
        const result = merge(target.owner, target.id, events, removeMissing);
        checkRoom(target.owner);
        const now = new Date().toISOString();
        markImported.run(sourceName || null, now, now, target.id);
        return { calendarId: target.id, ...result };
      });
    },

    /** Every calendar of the user's own with its events, and their settings. */
    exportAll(owner: string): ExportFile {
      const calendars = ownRows(owner).map((c): ExportCalendar => ({
        name: c.name,
        color: c.color,
        visible: c.visible === 1,
        events: (selectCalendarEvents.all(c.id) as unknown as EventRow[]).map((row) => {
          const e = toEvent(row);
          return { uid: e.uid, recurrenceId: e.recurrenceId, origin: e.origin, ...contentFrom(e) };
        }),
      }));
      return {
        format: "chronos",
        version: 1,
        exportedAt: new Date().toISOString(),
        calendars,
        settings: getSettings(owner),
      };
    },

    /**
     * Adds a backup to the owner's calendars: a calendar matches one here by name (ignoring case),
     * or is made; its events are merged as an import does, keeping whether they were made here.
     * Settings are taken only by a user who has none. A bad file changes nothing.
     */
    restore(owner: string, input: unknown): RestoreResult {
      const b = objectBody(input);
      if (b.format !== "chronos" || b.version !== 1)
        invalid("This is not a Chronos backup (format chronos, version 1)");
      if (!Array.isArray(b.calendars)) invalid("The file must have a calendars list");
      if (b.calendars.length > LIMITS.calendars) invalid(`At most ${LIMITS.calendars} calendars`);
      let total = 0;
      const calendars = b.calendars.map((value, i) => {
        try {
          const c = objectBody(value);
          if (!Array.isArray(c.events)) invalid("events must be a list");
          total += c.events.length;
          if (total > LIMITS.events) invalid(`At most ${LIMITS.events} events`);
          return {
            name: calendarName(c.name),
            color: COLORS.includes(c.color as Color) ? (c.color as Color) : null,
            visible: c.visible !== false,
            events: c.events.map((e) => ({
              ...importEventOf(e),
              origin: (e as { origin?: unknown }).origin === "user" ? ("user" as const) : ("import" as const),
            })),
          };
        } catch (err) {
          if (err instanceof StoreError) invalid(`Calendar ${i + 1}: ${err.message}`);
          throw err;
        }
      });
      const settings = b.settings === undefined ? null : settingsValue(b.settings);

      return transaction(() => {
        const result: RestoreResult = { calendars: 0, added: 0, updated: 0, unchanged: 0 };
        for (const c of calendars) {
          let id = ownRows(owner).find((row) => nameKey(row.name) === nameKey(c.name))?.id;
          if (!id) {
            id = addCalendar(owner, { name: c.name, color: c.color ?? freeColor(owner), visible: c.visible });
            result.calendars++;
          }
          const r = merge(owner, id, c.events, false);
          result.added += r.added;
          result.updated += r.updated;
          result.unchanged += r.unchanged;
        }
        checkRoom(owner);
        // Settings only where this user has none yet; a default calendar from elsewhere means nothing here.
        if (settings && !selectSettings.get(owner)) {
          upsertSettings.run(owner, JSON.stringify({ ...settings, defaultCalendarId: null }));
        }
        return result;
      });
    },

    /**
     * Deletes for good everything (calendars, events, settings) of every owner who isn't in `known`
     * (Heimdall's usernames), i.e. of users removed from Heimdall, and stops sharing calendars with
     * them. Returns how many events each had.
     */
    removeUnknownOwners(known: ReadonlySet<string>): { owner: string; events: number }[] {
      const $known = JSON.stringify([...known]);
      return transaction(() => {
        const removed = countUnknownOwners.all({ $known }) as { owner: string; events: number }[];
        for (const stmt of deleteUnknown) stmt.run({ $known });
        return removed;
      });
    },
  };
}

export type Store = ReturnType<typeof createStore>;
