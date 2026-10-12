import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { displayName, isWebUrl, phoneDigits, searchText } from "../shared/contact.ts";
import { isPartialDate } from "../shared/dates.ts";
import {
  ADDRESS_LABELS,
  BIN_DAYS,
  COLORS,
  DEFAULT_SETTINGS,
  EMAIL_LABELS,
  LIMITS,
  PHONE_LABELS,
  type Address,
  type Color,
  type Contact,
  type ContactDate,
  type ContactFields,
  type ContactSaved,
  type ContactSummary,
  type Email,
  type ErrorCode,
  type ExportContact,
  type ExportFile,
  type Group,
  type GroupFields,
  type ImportResult,
  type Phone,
  type Settings,
  type Website,
} from "../shared/protocol.ts";
import { parseQuery } from "../shared/query.ts";
import { normalize } from "../shared/words.ts";

// The only place contacts are read and written. Every query names the owner (a Heimdall
// username), so nobody reaches another user's contacts; a row that belongs to someone else
// answers exactly like one that doesn't exist.

/** A request the store refuses, with the HTTP status to answer. */
export class StoreError extends Error {
  readonly status: number;
  readonly code: ErrorCode | undefined;
  /** with "conflict": the contact as it is now */
  readonly contact: Contact | undefined;
  constructor(status: number, message: string, code?: ErrorCode, contact?: Contact) {
    super(message);
    this.status = status;
    this.code = code;
    this.contact = contact;
  }
}

interface ContactRow {
  id: string;
  owner: string;
  first_name: string;
  last_name: string;
  nickname: string;
  company: string;
  title: string;
  birthday: string | null;
  phones: string;
  emails: string;
  addresses: string;
  websites: string;
  dates: string;
  memo: string;
  favorite: number;
  rev: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  group_ids: string;
}

interface SummaryRow {
  id: string;
  first_name: string;
  last_name: string;
  nickname: string;
  company: string;
  title: string;
  favorite: number;
  group_ids: string;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  dates: string;
  rev: number;
  deleted_at: string | null;
}

interface GroupRow {
  id: string;
  owner: string;
  name: string;
  color: Color;
  members: number;
}

type Fields = Omit<ContactFields, "groupIds">;

function invalid(message: string): never {
  throw new StoreError(400, message, "invalid");
}

const notFound = (what: string): never => {
  throw new StoreError(404, `No such ${what}`, "not-found");
};

function objectBody(input: unknown, what = "The request body"): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) invalid(`${what} must be a JSON object`);
  return input as Record<string, unknown>;
}

/** A text field; missing is empty. Single-line fields are trimmed. */
function text(value: unknown, name: string, max: number, trim = true): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") invalid(`${name} must be text`);
  const s = trim ? value.trim() : value;
  if (s.length > max) invalid(`${name} is longer than ${max} characters`);
  return s;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], name: string): T {
  if (!options.includes(value as T)) invalid(`${name} must be one of ${options.join(", ")}`);
  return value as T;
}

/** A list of rows, each checked by `row`; rows that come out blank are dropped. */
function rows<T>(value: unknown, name: string, max: number, row: (o: Record<string, unknown>, at: string) => T | null) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) invalid(`${name} must be a list`);
  const list = value
    .map((v, i) => row(objectBody(v, `${name} ${i + 1}`), `${name} ${i + 1}`))
    .filter((v) => v !== null);
  if (list.length > max) invalid(`At most ${max} ${name.toLowerCase()}`);
  return list;
}

const EMAIL = /^[^\s@]+@[^\s@]+$/;

function phone(o: Record<string, unknown>, at: string): Phone | null {
  const number = text(o.number, `${at}: the number`, LIMITS.fieldChars);
  if (!number) return null;
  if (!/\d/.test(number)) invalid(`${at}: "${number}" has no digits`);
  return { label: oneOf(o.label ?? "mobile", PHONE_LABELS, `${at}: the label`), number, whatsapp: o.whatsapp === true };
}

function email(o: Record<string, unknown>, at: string): Email | null {
  const address = text(o.address, `${at}: the address`, LIMITS.fieldChars);
  if (!address) return null;
  if (!EMAIL.test(address)) invalid(`${at}: "${address}" isn't an email address`);
  return { label: oneOf(o.label ?? "home", EMAIL_LABELS, `${at}: the label`), address };
}

const ADDRESS_PARTS = ["street", "number", "complement", "district", "city", "state", "postalCode", "country"] as const;

function address(o: Record<string, unknown>, at: string): Address | null {
  const parts = Object.fromEntries(ADDRESS_PARTS.map((k) => [k, text(o[k], `${at}: ${k}`, LIMITS.fieldChars)]));
  if (ADDRESS_PARTS.every((k) => !parts[k])) return null;
  return { label: oneOf(o.label ?? "home", ADDRESS_LABELS, `${at}: the label`), ...parts } as Address;
}

function website(o: Record<string, unknown>, at: string): Website | null {
  let url = text(o.url, `${at}: the address`, LIMITS.urlChars);
  if (!url) return null;
  // "example.com" is meant as a web address.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
  if (!isWebUrl(url)) invalid(`${at}: only http:// and https:// addresses can be kept`);
  return { label: text(o.label, `${at}: the label`, LIMITS.fieldChars), url };
}

function contactDate(o: Record<string, unknown>, at: string): ContactDate | null {
  const label = text(o.label, `${at}: the label`, LIMITS.fieldChars);
  if (o.date === undefined || o.date === null || o.date === "") {
    if (label) invalid(`${at}: the date is missing`);
    return null;
  }
  if (!isPartialDate(o.date)) invalid(`${at}: the date must be YYYY-MM-DD, or --MM-DD without the year`);
  return { label, date: o.date };
}

/** A contact's fields from a request, checked and tidied (blank rows dropped), groups aside. */
function fieldsOf(input: unknown, what?: string): Fields {
  const b = objectBody(input, what);
  const fields: Fields = {
    firstName: text(b.firstName, "The first name", LIMITS.nameChars),
    lastName: text(b.lastName, "The last name", LIMITS.nameChars),
    nickname: text(b.nickname, "The nickname", LIMITS.nameChars),
    company: text(b.company, "The company", LIMITS.fieldChars),
    title: text(b.title, "The job title", LIMITS.fieldChars),
    birthday: null,
    phones: rows(b.phones, "Phones", LIMITS.phones, phone),
    emails: rows(b.emails, "Emails", LIMITS.emails, email),
    addresses: rows(b.addresses, "Addresses", LIMITS.addresses, address),
    websites: rows(b.websites, "Websites", LIMITS.websites, website),
    dates: rows(b.dates, "Dates", LIMITS.dates, contactDate),
    memo: text(b.memo, "The memo", LIMITS.memoChars, false).trimEnd(),
  };
  if (b.birthday !== undefined && b.birthday !== null && b.birthday !== "") {
    if (!isPartialDate(b.birthday)) invalid("The birthday must be YYYY-MM-DD, or --MM-DD without the year");
    fields.birthday = b.birthday;
  }
  if (!fields.firstName && !fields.lastName && !fields.nickname && !fields.company) {
    invalid("A contact needs a name or a company");
  }
  return fields;
}

function groupName(value: unknown): string {
  const name = text(value, "The group name", LIMITS.groupNameChars);
  if (!name) invalid("The group name is empty");
  return name;
}

function color(value: unknown): Color {
  return oneOf(value, COLORS, "The colour");
}

/** Names compare without case: "Family" and "family" are the same group. */
const nameKey = (name: string) => name.normalize("NFC").toLowerCase();

function settingsValue(input: unknown): Settings {
  const b = objectBody(input);
  const sortBy = b.sortBy ?? DEFAULT_SETTINGS.sortBy;
  if (sortBy !== "first" && sortBy !== "last") invalid('sortBy must be "first" or "last"');
  const countryCode = text(b.countryCode ?? DEFAULT_SETTINGS.countryCode, "The country code", 10).replace(/^\+/, "");
  if (!/^\d{0,4}$/.test(countryCode)) invalid("The country code must be up to 4 digits, such as 55");
  return { sortBy, countryCode };
}

const isoOr = (value: unknown, fallback: string) =>
  typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : fallback;

/** The same phone number, however it was written: one's digits end the other's (+55 11 … and 11 …). */
function samePhone(a: string, b: string): boolean {
  const x = phoneDigits(a);
  const y = phoneDigits(b);
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 8 ? long.endsWith(short) : short.length > 0 && short === long;
}

const sameEmail = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const addressKey = (a: Address) => normalize(ADDRESS_PARTS.map((k) => a[k]).join("|"));

/** Whether two contacts from different places are the same person (see importAll). */
function samePerson(a: Fields, b: Fields): boolean {
  if (normalize(displayName(a)) !== normalize(displayName(b))) return false;
  const aHas = a.phones.length + a.emails.length > 0;
  const bHas = b.phones.length + b.emails.length > 0;
  if (!aHas || !bHas) return !aHas && !bHas;
  return (
    a.phones.some((p) => b.phones.some((q) => samePhone(p.number, q.number))) ||
    a.emails.some((e) => b.emails.some((f) => sameEmail(e.address, f.address)))
  );
}

/**
 * `into` with what `from` adds to it: empty fields filled, rows it lacks added (up to the
 * limits), a memo it doesn't hold added after a blank line.
 */
function merged(into: Fields, from: Fields): Fields {
  const out: Fields = structuredClone(into);
  for (const key of ["firstName", "lastName", "nickname", "company", "title"] as const) {
    if (!out[key]) out[key] = from[key];
  }
  // A birthday without the year gains it if the other has the same day with one.
  if (!out.birthday) out.birthday = from.birthday;
  else if (from.birthday && out.birthday === `--${from.birthday.slice(5)}`) out.birthday = from.birthday;
  const add = <T>(list: T[], extra: T[], max: number, same: (a: T, b: T) => boolean) => {
    for (const row of extra) if (list.length < max && !list.some((r) => same(r, row))) list.push(row);
  };
  add(out.phones, from.phones, LIMITS.phones, (a, b) => samePhone(a.number, b.number));
  add(out.emails, from.emails, LIMITS.emails, (a, b) => sameEmail(a.address, b.address));
  add(out.addresses, from.addresses, LIMITS.addresses, (a, b) => addressKey(a) === addressKey(b));
  add(out.websites, from.websites, LIMITS.websites, (a, b) => a.url === b.url);
  add(out.dates, from.dates, LIMITS.dates, (a, b) => a.date === b.date && nameKey(a.label) === nameKey(b.label));
  if (from.memo && !out.memo.includes(from.memo)) {
    const memo = out.memo ? `${out.memo}\n\n${from.memo}` : from.memo;
    if (memo.length <= LIMITS.memoChars) out.memo = memo;
  }
  return out;
}

const sameFields = (a: Fields, b: Fields) => JSON.stringify(a) === JSON.stringify(b);

export function createStore(db: DatabaseSync) {
  const GROUP_IDS =
    "(SELECT coalesce(json_group_array(group_id), '[]') FROM contact_groups g WHERE g.contact_id = c.id)";
  const selectContact = db.prepare(
    `SELECT c.*, ${GROUP_IDS} AS group_ids FROM contacts c WHERE c.id = ? AND c.owner = ?`,
  );
  const selectLiveContacts = db.prepare(
    `SELECT c.*, ${GROUP_IDS} AS group_ids FROM contacts c WHERE c.owner = ? AND c.deleted_at IS NULL ORDER BY c.created_at, c.id`,
  );
  const countContacts = db.prepare("SELECT count(*) AS n FROM contacts WHERE owner = ?");
  const insertContact = db.prepare(
    `INSERT INTO contacts (id, owner, first_name, last_name, nickname, company, title, birthday, phones, emails,
       addresses, websites, dates, memo, favorite, search, rev, created_at, updated_at)
     VALUES ($id, $owner, $first_name, $last_name, $nickname, $company, $title, $birthday, $phones, $emails,
       $addresses, $websites, $dates, $memo, $favorite, $search, $rev, $created_at, $updated_at)`,
  );
  const updateContact = db.prepare(
    `UPDATE contacts SET first_name = $first_name, last_name = $last_name, nickname = $nickname, company = $company,
       title = $title, birthday = $birthday, phones = $phones, emails = $emails, addresses = $addresses,
       websites = $websites, dates = $dates, memo = $memo, search = $search, rev = $rev, updated_at = $updated_at
     WHERE id = $id AND owner = $owner`,
  );
  const setFavorite = db.prepare("UPDATE contacts SET favorite = ? WHERE id = ? AND owner = ?");
  const setDeleted = db.prepare("UPDATE contacts SET deleted_at = ? WHERE id = ? AND owner = ?");
  const deleteContact = db.prepare("DELETE FROM contacts WHERE id = ? AND owner = ?");
  const purgeBin = db.prepare("DELETE FROM contacts WHERE deleted_at IS NOT NULL AND deleted_at < ?");
  const nextRev = db.prepare("UPDATE meta SET value = value + 1 WHERE key = 'rev' RETURNING value");

  const deleteMemberships = db.prepare("DELETE FROM contact_groups WHERE contact_id = ?");
  const insertMembership = db.prepare("INSERT OR IGNORE INTO contact_groups (contact_id, group_id) VALUES (?, ?)");

  const selectGroups = db.prepare(
    `SELECT g.*, (SELECT count(*) FROM contact_groups m JOIN contacts c ON c.id = m.contact_id
                  WHERE m.group_id = g.id AND c.deleted_at IS NULL) AS members
     FROM groups g WHERE g.owner = ? ORDER BY g.name COLLATE NOCASE, g.id`,
  );
  const insertGroup = db.prepare(
    "INSERT INTO groups (id, owner, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const updateGroupRow = db.prepare("UPDATE groups SET name = ?, color = ?, updated_at = ? WHERE id = ? AND owner = ?");
  const deleteGroupRow = db.prepare("DELETE FROM groups WHERE id = ? AND owner = ?");

  const selectSettings = db.prepare("SELECT data FROM settings WHERE owner = ?");
  const upsertSettings = db.prepare(
    "INSERT INTO settings (owner, data) VALUES (?, ?) ON CONFLICT (owner) DO UPDATE SET data = excluded.data",
  );

  // $known: a JSON array of usernames.
  const UNKNOWN_OWNER = "owner NOT IN (SELECT value FROM json_each($known))";
  const countUnknownOwners = db.prepare(`
    SELECT owner, sum(contact) AS contacts FROM (
      SELECT owner, 1 AS contact FROM contacts WHERE ${UNKNOWN_OWNER}
      UNION ALL SELECT owner, 0 FROM groups WHERE ${UNKNOWN_OWNER}
      UNION ALL SELECT owner, 0 FROM settings WHERE ${UNKNOWN_OWNER}
    ) GROUP BY owner ORDER BY owner`);
  // Contacts and groups take their memberships with them.
  const deleteUnknown = ["contacts", "groups", "settings"].map((table) =>
    db.prepare(`DELETE FROM ${table} WHERE ${UNKNOWN_OWNER}`),
  );

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

  function toContact(row: ContactRow): Contact {
    return {
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      nickname: row.nickname,
      company: row.company,
      title: row.title,
      birthday: row.birthday,
      phones: JSON.parse(row.phones) as Phone[],
      emails: JSON.parse(row.emails) as Email[],
      addresses: JSON.parse(row.addresses) as Address[],
      websites: JSON.parse(row.websites) as Website[],
      dates: JSON.parse(row.dates) as ContactDate[],
      memo: row.memo,
      favorite: row.favorite === 1,
      groupIds: (JSON.parse(row.group_ids) as string[]).sort(),
      rev: row.rev,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    };
  }

  const toSummary = (row: SummaryRow): ContactSummary => ({
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    nickname: row.nickname,
    company: row.company,
    title: row.title,
    favorite: row.favorite === 1,
    groupIds: JSON.parse(row.group_ids) as string[],
    phone: row.phone ?? "",
    email: row.email ?? "",
    birthday: row.birthday,
    dates: JSON.parse(row.dates) as ContactDate[],
    rev: row.rev,
    deletedAt: row.deleted_at,
  });

  const fieldsFrom = (c: Contact): Fields => ({
    firstName: c.firstName,
    lastName: c.lastName,
    nickname: c.nickname,
    company: c.company,
    title: c.title,
    birthday: c.birthday,
    phones: c.phones,
    emails: c.emails,
    addresses: c.addresses,
    websites: c.websites,
    dates: c.dates,
    memo: c.memo,
  });

  function contactRow(owner: string, id: string): ContactRow {
    return (selectContact.get(id, owner) as ContactRow | undefined) ?? notFound("contact");
  }

  /** A contact outside the recycle bin: the only kind that can be read or changed. */
  function liveContact(owner: string, id: string): Contact {
    const row = contactRow(owner, id);
    if (row.deleted_at) notFound("contact");
    return toContact(row);
  }

  const groupRows = (owner: string) => selectGroups.all(owner) as unknown as GroupRow[];

  /** Group ids from a request: each one of the owner's groups, once. */
  function groupIdsOf(owner: string, value: unknown): string[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) invalid("groupIds must be a list of group ids");
    const mine = new Set(groupRows(owner).map((g) => g.id));
    for (const id of value) if (typeof id !== "string" || !mine.has(id)) invalid("No such group");
    return [...new Set(value as string[])].sort();
  }

  function checkGroupNameFree(owner: string, name: string, exceptId?: string): void {
    const clash = groupRows(owner).find((g) => g.id !== exceptId && nameKey(g.name) === nameKey(name));
    if (clash) throw new StoreError(409, `There is already a group called ${clash.name}`, "exists");
  }

  function addGroup(owner: string, fields: GroupFields): string {
    if (groupRows(owner).length >= LIMITS.groups) {
      throw new StoreError(409, `At most ${LIMITS.groups} groups`, "too-many");
    }
    checkGroupNameFree(owner, fields.name);
    const id = randomUUID();
    const now = new Date().toISOString();
    insertGroup.run(id, owner, fields.name, fields.color, now, now);
    return id;
  }

  function checkRoom(owner: string, adding: number): void {
    const { n } = countContacts.get(owner) as { n: number };
    if (n + adding > LIMITS.contacts) {
      throw new StoreError(409, `At most ${LIMITS.contacts} contacts (the recycle bin counts too)`, "too-many");
    }
  }

  const columns = (f: Fields, rev: number) => ({
    $first_name: f.firstName,
    $last_name: f.lastName,
    $nickname: f.nickname,
    $company: f.company,
    $title: f.title,
    $birthday: f.birthday,
    $phones: JSON.stringify(f.phones),
    $emails: JSON.stringify(f.emails),
    $addresses: JSON.stringify(f.addresses),
    $websites: JSON.stringify(f.websites),
    $dates: JSON.stringify(f.dates),
    $memo: f.memo,
    $search: searchText(f),
    $rev: rev,
  });

  const newRev = () => (nextRev.get() as { value: number }).value;

  function setGroups(contactId: string, groupIds: readonly string[]): void {
    deleteMemberships.run(contactId);
    for (const g of groupIds) insertMembership.run(contactId, g);
  }

  /** Stores a new contact. Runs inside a transaction. */
  function insert(
    owner: string,
    f: Fields,
    groupIds: readonly string[],
    favorite: boolean,
    times?: { createdAt: string; updatedAt: string },
  ): ContactSaved {
    const id = randomUUID();
    const rev = newRev();
    const now = new Date().toISOString();
    const updatedAt = times?.updatedAt ?? now;
    insertContact.run({
      $id: id,
      $owner: owner,
      ...columns(f, rev),
      $favorite: favorite ? 1 : 0,
      $created_at: times?.createdAt ?? now,
      $updated_at: updatedAt,
    });
    setGroups(id, groupIds);
    return { id, rev, updatedAt };
  }

  /** Writes a contact's new fields and groups, with a new rev. Runs inside a transaction. */
  function update(owner: string, id: string, f: Fields, groupIds: readonly string[]): ContactSaved {
    const rev = newRev();
    const updatedAt = new Date().toISOString();
    updateContact.run({ $id: id, $owner: owner, ...columns(f, rev), $updated_at: updatedAt });
    setGroups(id, groupIds);
    return { id, rev, updatedAt };
  }

  function getSettings(owner: string): Settings {
    const row = selectSettings.get(owner) as { data: string } | undefined;
    return row ? { ...DEFAULT_SETTINGS, ...(JSON.parse(row.data) as Partial<Settings>) } : { ...DEFAULT_SETTINGS };
  }

  return {
    // ── Contacts ──────────────────────────────────────────────────────────────────────────────

    /**
     * The owner's contacts as the list shows them, unsorted (the page sorts them in the reader's
     * language). q: a search (shared/query.ts); group: a group id; favorites: "1"; bin: "1" for
     * the recycle bin instead.
     */
    list(owner: string, query: { q?: unknown; group?: unknown; favorites?: unknown; bin?: unknown }): ContactSummary[] {
      const q = text(query.q, "The search", LIMITS.queryChars);
      const conditions = ["c.owner = ?", query.bin === "1" ? "c.deleted_at IS NOT NULL" : "c.deleted_at IS NULL"];
      const params: SQLInputValue[] = [owner];
      if (query.favorites === "1") conditions.push("c.favorite = 1");
      if (query.group !== undefined && query.group !== "") {
        if (typeof query.group !== "string") invalid("group must be a group id");
        conditions.push("EXISTS (SELECT 1 FROM contact_groups g WHERE g.contact_id = c.id AND g.group_id = ?)");
        params.push(query.group);
      }
      for (const t of parseQuery(q)) {
        if (t.digits) {
          conditions.push("(instr(c.search, ?) > 0 OR instr(c.search, ?) > 0)");
          params.push(t.value, t.digits);
        } else {
          conditions.push("instr(c.search, ?) > 0");
          params.push(t.value);
        }
      }
      const found = db
        .prepare(
          `SELECT c.id, c.first_name, c.last_name, c.nickname, c.company, c.title, c.favorite, ${GROUP_IDS} AS group_ids,
             json_extract(c.phones, '$[0].number') AS phone, json_extract(c.emails, '$[0].address') AS email,
             c.birthday, c.dates, c.rev, c.deleted_at
           FROM contacts c WHERE ${conditions.join(" AND ")}`,
        )
        .all(...params) as unknown as SummaryRow[];
      return found.map(toSummary);
    },

    /** A contact outside the recycle bin. */
    get(owner: string, id: string): Contact {
      return liveContact(owner, id);
    },

    create(owner: string, input: unknown): ContactSaved {
      const fields = fieldsOf(input);
      const b = input as Record<string, unknown>;
      return transaction(() => {
        checkRoom(owner, 1);
        return insert(owner, fields, groupIdsOf(owner, b.groupIds), b.favorite === true);
      });
    },

    /**
     * Saves a contact: its fields, groupIds and the rev the editor started from. If the contact
     * changed since, the answer is 409 "conflict" with the contact as it is now. Sending what is
     * already stored always succeeds, so a retry after a lost answer is harmless.
     */
    put(owner: string, id: string, input: unknown): ContactSaved {
      const fields = fieldsOf(input);
      const b = input as Record<string, unknown>;
      if (!Number.isSafeInteger(b.rev)) invalid("rev must be a whole number");
      return transaction(() => {
        const current = liveContact(owner, id);
        const groupIds = groupIdsOf(owner, b.groupIds);
        if (sameFields(fields, fieldsFrom(current)) && JSON.stringify(groupIds) === JSON.stringify(current.groupIds)) {
          return { id, rev: current.rev, updatedAt: current.updatedAt };
        }
        if (b.rev !== current.rev) {
          throw new StoreError(
            409,
            "This contact was changed somewhere else since you opened it.",
            "conflict",
            current,
          );
        }
        return update(owner, id, fields, groupIds);
      });
    },

    /** Stars a contact, or takes the star away: { favorite }. */
    patch(owner: string, id: string, input: unknown): Contact {
      const b = objectBody(input);
      if (typeof b.favorite !== "boolean") invalid("favorite must be true or false");
      liveContact(owner, id);
      setFavorite.run(b.favorite ? 1 : 0, id, owner);
      return liveContact(owner, id);
    },

    /** Moves a contact to the recycle bin. */
    bin(owner: string, id: string): void {
      const row = contactRow(owner, id);
      if (!row.deleted_at) setDeleted.run(new Date().toISOString(), id, owner);
    },

    /** Takes a contact out of the recycle bin. */
    restore(owner: string, id: string): Contact {
      const row = contactRow(owner, id);
      if (row.deleted_at) setDeleted.run(null, id, owner);
      return liveContact(owner, id);
    },

    /** Deletes a contact for good. Only from the recycle bin. */
    purgeContact(owner: string, id: string): void {
      const row = contactRow(owner, id);
      if (!row.deleted_at) throw new StoreError(409, "Move the contact to the recycle bin first.", "not-in-bin");
      deleteContact.run(id, owner);
    },

    /** Empties the recycle bin of contacts deleted more than BIN_DAYS ago. Returns how many went. */
    purge(now: number = Date.now()): number {
      const before = new Date(now - BIN_DAYS * 24 * 60 * 60_000).toISOString();
      return Number(purgeBin.run(before).changes);
    },

    // ── Groups and settings ───────────────────────────────────────────────────────────────────

    groups(owner: string): Group[] {
      return groupRows(owner).map(({ id, name, color: c, members }) => ({ id, name, color: c, members }));
    },

    createGroup(owner: string, input: unknown): Group {
      const b = objectBody(input);
      const name = groupName(b.name);
      return transaction(() => {
        let c: Color;
        if (b.color !== undefined) c = color(b.color);
        else {
          // The first colour no group has yet.
          const used = new Set(groupRows(owner).map((g) => g.color));
          c = COLORS.find((x) => !used.has(x)) ?? COLORS[0];
        }
        const id = addGroup(owner, { name, color: c });
        return { id, name, color: c, members: 0 };
      });
    },

    updateGroup(owner: string, id: string, input: unknown): Group {
      const row = groupRows(owner).find((g) => g.id === id) ?? notFound("group");
      const b = objectBody(input);
      const name = b.name === undefined ? row.name : groupName(b.name);
      if (b.name !== undefined) checkGroupNameFree(owner, name, id);
      const c = b.color === undefined ? row.color : color(b.color);
      updateGroupRow.run(name, c, new Date().toISOString(), id, owner);
      return { id, name, color: c, members: row.members };
    },

    /** Deletes a group. Its contacts stay, outside it. */
    deleteGroup(owner: string, id: string): void {
      if (Number(deleteGroupRow.run(id, owner).changes) === 0) notFound("group");
    },

    settings: getSettings,

    putSettings(owner: string, input: unknown): Settings {
      const settings = settingsValue(input);
      upsertSettings.run(owner, JSON.stringify(settings));
      return settings;
    },

    // ── Users, export and import ──────────────────────────────────────────────────────────────

    /**
     * Deletes for good everything (contacts, recycle bin included, groups, settings) of every owner
     * who isn't in `known` (Heimdall's usernames), i.e. of users removed from Heimdall. Returns how
     * many contacts each of them had.
     */
    removeUnknownOwners(known: ReadonlySet<string>): { owner: string; contacts: number }[] {
      const $known = JSON.stringify([...known]);
      return transaction(() => {
        const removed = countUnknownOwners.all({ $known }) as { owner: string; contacts: number }[];
        for (const stmt of deleteUnknown) stmt.run({ $known });
        return removed;
      });
    },

    /** Every contact (recycle bin left out), the groups and the settings. */
    exportAll(owner: string): ExportFile {
      const groups = groupRows(owner);
      const groupName = new Map(groups.map((g) => [g.id, g.name]));
      const contacts = (selectLiveContacts.all(owner) as unknown as ContactRow[]).map(toContact);
      return {
        format: "vinr",
        version: 1,
        exportedAt: new Date().toISOString(),
        groups: groups.map((g) => ({ name: g.name, color: g.color })),
        contacts: contacts.map((c): ExportContact => ({
          ...fieldsFrom(c),
          favorite: c.favorite,
          groups: c.groupIds.map((id) => groupName.get(id)!),
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        })),
        settings: getSettings(owner),
      };
    },

    /**
     * Adds an export file (or contacts read from vCard by the page, in the same shape) to the
     * owner's contacts. Groups are matched by name, ignoring case. A contact matches one already
     * here (outside the recycle bin) when their names are the same, ignoring case and accents, and
     * they share a phone number or an email address (or neither has any); it then fills what that
     * one lacks (see merged). Anything else is a new contact. So importing the same file twice
     * changes nothing. Everything is checked before anything is written: a bad file changes nothing.
     */
    importAll(owner: string, input: unknown): ImportResult {
      const b = objectBody(input);
      if (b.format !== "vinr" || b.version !== 1) invalid("This is not a Vinr export file (format vinr, version 1)");
      if (!Array.isArray(b.contacts)) invalid("The file must have a contacts list");
      if (b.contacts.length > LIMITS.importContacts) {
        invalid(`At most ${LIMITS.importContacts} contacts can be imported at once`);
      }
      const within = <T>(where: string, fn: () => T): T => {
        try {
          return fn();
        } catch (err) {
          if (err instanceof StoreError) invalid(`${where}: ${err.message}`);
          throw err;
        }
      };
      const now = new Date().toISOString();
      const groupsIn = (Array.isArray(b.groups) ? b.groups : []).map((value, i) =>
        within(`Group ${i + 1}`, () => {
          const g = objectBody(value);
          return { name: groupName(g.name), color: COLORS.includes(g.color as Color) ? (g.color as Color) : null };
        }),
      );
      const contactsIn = b.contacts.map((value, i) =>
        within(`Contact ${i + 1}`, () => {
          const c = objectBody(value);
          const groups = Array.isArray(c.groups) ? c.groups.map((g) => groupName(g)) : [];
          return {
            fields: fieldsOf(c),
            favorite: c.favorite === true,
            groups,
            times: { createdAt: isoOr(c.createdAt, now), updatedAt: isoOr(c.updatedAt, now) },
          };
        }),
      );
      const settings = b.settings === undefined ? null : within("Settings", () => settingsValue(b.settings));

      return transaction(() => {
        const result: ImportResult = { added: 0, merged: 0, unchanged: 0, groups: 0 };

        // Groups by name: those of the file (with their colour), then any a contact names.
        const groupIds = new Map(groupRows(owner).map((g) => [nameKey(g.name), g.id]));
        const groupId = (name: string, c: Color | null) => {
          let id = groupIds.get(nameKey(name));
          if (!id) {
            const used = new Set(groupRows(owner).map((g) => g.color));
            id = addGroup(owner, { name, color: c ?? COLORS.find((x) => !used.has(x)) ?? COLORS[0] });
            groupIds.set(nameKey(name), id);
            result.groups++;
          }
          return id;
        };
        for (const g of groupsIn) groupId(g.name, g.color);

        // Everyone already here, by name, kept up to date as the file is read (it may hold
        // the same person twice).
        const byName = new Map<string, Contact[]>();
        const file = (c: Contact) => {
          const key = normalize(displayName(c));
          byName.set(key, [...(byName.get(key) ?? []), c]);
        };
        for (const row of selectLiveContacts.all(owner) as unknown as ContactRow[]) file(toContact(row));

        for (const c of contactsIn) {
          const ids = [...new Set(c.groups.map((name) => groupId(name, null)))].sort();
          const match = byName.get(normalize(displayName(c.fields)))?.find((e) => samePerson(fieldsFrom(e), c.fields));
          if (!match) {
            const saved = insert(owner, c.fields, ids, c.favorite, c.times);
            file({ ...c.fields, ...saved, favorite: c.favorite, groupIds: ids, createdAt: now, deletedAt: null });
            result.added++;
            continue;
          }
          const fields = merged(fieldsFrom(match), c.fields);
          const allGroups = [...new Set([...match.groupIds, ...ids])].sort();
          const star = c.favorite && !match.favorite;
          if (sameFields(fields, fieldsFrom(match)) && allGroups.length === match.groupIds.length && !star) {
            result.unchanged++;
            continue;
          }
          const saved = update(owner, match.id, fields, allGroups);
          if (star) setFavorite.run(1, match.id, owner);
          Object.assign(match, fields, saved, { groupIds: allGroups, favorite: match.favorite || star });
          result.merged++;
        }

        // Too many now? The transaction undoes it all.
        checkRoom(owner, 0);
        // Settings only where this user has none yet.
        if (settings && !selectSettings.get(owner)) upsertSettings.run(owner, JSON.stringify(settings));
        return result;
      });
    },
  };
}

export type Store = ReturnType<typeof createStore>;
