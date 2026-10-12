import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  BIN_DAYS,
  LIMITS,
  type Entry,
  type EntryFields,
  type EntrySummary,
  type ErrorCode,
  type ExportEntry,
  type ExportFile,
  type Group,
  type ImportResult,
  type TotpInfo,
  type Vault,
} from "../shared/protocol.ts";
import { formatOtpauth, parseTotpInput, totp, type TotpCode, type TotpParams } from "../shared/totp.ts";
import { OpenError, type Sealer } from "./seal.ts";

// The only place vaults are read and written. Every query names the owner (a Heimdall username),
// so nobody reaches another user's groups or entries; a row that belongs to someone else answers
// exactly like one that doesn't exist.

/** A request the vault refuses, with the HTTP status to answer. */
export class VaultError extends Error {
  readonly status: number;
  readonly code: ErrorCode | undefined;
  constructor(status: number, message: string, code?: ErrorCode) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The database was sealed with another key than the one the service has. */
export class KeyMismatchError extends Error {}

interface GroupRow {
  id: string;
  owner: string;
  parent_id: string | null;
  data: Uint8Array;
  created_at: string;
  updated_at: string;
}

interface EntryRow {
  id: string;
  owner: string;
  group_id: string | null;
  data: Uint8Array;
  totp: Uint8Array | null;
  rev: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

const FIELD_LIMITS: Record<keyof EntryFields, number> = {
  title: LIMITS.titleChars,
  username: LIMITS.usernameChars,
  password: LIMITS.passwordChars,
  url: LIMITS.urlChars,
  notes: LIMITS.notesChars,
};
const FIELD_NAMES = Object.keys(FIELD_LIMITS) as (keyof EntryFields)[];
const EMPTY_FIELDS: EntryFields = { title: "", username: "", password: "", url: "", notes: "" };

const KEY_CHECK = "key_check";
const KEY_CHECK_CONTEXT = "meta:key_check";

// What each sealed value is bound to (see seal.ts).
const groupContext = (row: { owner: string; id: string }) => `groups:${row.owner}:${row.id}`;
const dataContext = (row: { owner: string; id: string }) => `entries.data:${row.owner}:${row.id}`;
const totpContext = (row: { owner: string; id: string }) => `entries.totp:${row.owner}:${row.id}`;

function invalid(message: string): never {
  throw new VaultError(400, message, "invalid");
}

function objectBody(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    invalid("The request body must be a JSON object");
  }
  return input as Record<string, unknown>;
}

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== "string") invalid(`${name} must be text`);
  if (value.length > max) invalid(`${name} is longer than ${max} characters`);
  return value;
}

function groupName(value: unknown): string {
  const name = text(value, "The group name", LIMITS.groupNameChars).trim();
  if (!name) invalid("The group name is empty");
  return name;
}

/** The entry fields present in a request body. */
function entryFields(b: Record<string, unknown>): Partial<EntryFields> {
  const fields: Partial<EntryFields> = {};
  for (const name of FIELD_NAMES) {
    if (b[name] !== undefined) fields[name] = text(b[name], name, FIELD_LIMITS[name]);
  }
  return fields;
}

function totpParams(value: unknown): TotpParams {
  const parsed = parseTotpInput(text(value, "totp", LIMITS.totpInputChars));
  if (typeof parsed === "string") invalid(parsed);
  return parsed;
}

const totpInfo = ({ secret: _secret, ...info }: TotpParams): TotpInfo => info;

const isoOr = (value: unknown, fallback: string) =>
  typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : fallback;

export function createVault(db: DatabaseSync, sealer: Sealer) {
  // The key check comes first: with the wrong key, nothing below could be read.
  const check = db.prepare("SELECT value FROM meta WHERE key = ?").get(KEY_CHECK) as { value: Uint8Array } | undefined;
  if (!check) {
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(KEY_CHECK, sealer.seal("janus", KEY_CHECK_CONTEXT));
  } else {
    try {
      sealer.open(check.value, KEY_CHECK_CONTEXT);
    } catch (err) {
      if (!(err instanceof OpenError)) throw err;
      throw new KeyMismatchError(
        "The database was encrypted with a different key. Restore the key it was made with " +
          "(/etc/axis-suite/janus.key on a server, data/janus.key in development).",
      );
    }
  }

  const selectGroups = db.prepare("SELECT * FROM groups WHERE owner = ?");
  const selectGroup = db.prepare("SELECT * FROM groups WHERE id = ? AND owner = ?");
  const insertGroup = db.prepare(
    "INSERT INTO groups (id, owner, parent_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *",
  );
  const updateGroupRow = db.prepare(
    "UPDATE groups SET parent_id = ?, data = ?, updated_at = ? WHERE id = ? AND owner = ? RETURNING *",
  );
  const deleteGroupRow = db.prepare("DELETE FROM groups WHERE id = ? AND owner = ?");
  const countSubgroups = db.prepare("SELECT count(*) AS n FROM groups WHERE parent_id = ? AND owner = ?");
  const countLiveEntries = db.prepare(
    "SELECT count(*) AS n FROM entries WHERE group_id = ? AND owner = ? AND deleted_at IS NULL",
  );
  // Entries in the recycle bin may still name a group being deleted; restored, they land at the top.
  const releaseBinEntries = db.prepare(
    "UPDATE entries SET group_id = NULL, rev = rev + 1 WHERE group_id = ? AND owner = ?",
  );

  const selectEntries = db.prepare("SELECT * FROM entries WHERE owner = ?");
  const selectEntry = db.prepare("SELECT * FROM entries WHERE id = ? AND owner = ?");
  const insertEntry = db.prepare(
    `INSERT INTO entries (id, owner, group_id, data, totp, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  );
  const updateEntryRow = db.prepare(
    `UPDATE entries SET group_id = ?, data = ?, totp = ?, deleted_at = ?, rev = rev + 1, updated_at = ?
     WHERE id = ? AND owner = ? RETURNING *`,
  );
  const deleteEntryRow = db.prepare("DELETE FROM entries WHERE id = ? AND owner = ?");
  const purgeBin = db.prepare("DELETE FROM entries WHERE deleted_at IS NOT NULL AND deleted_at < ?");
  // $known: a JSON array of usernames.
  const UNKNOWN_OWNER = "owner NOT IN (SELECT value FROM json_each($known))";
  const countUnknownOwners = db.prepare(`
    SELECT owner, sum(entry) AS entries, sum(1 - entry) AS groups FROM (
      SELECT owner, 1 AS entry FROM entries WHERE ${UNKNOWN_OWNER}
      UNION ALL
      SELECT owner, 0 AS entry FROM groups WHERE ${UNKNOWN_OWNER}
    ) GROUP BY owner ORDER BY owner`);
  // Entries first: they point at the groups. Each group points only at groups of its own owner,
  // and the foreign keys are checked once the whole statement is done.
  const deleteUnknownEntries = db.prepare(`DELETE FROM entries WHERE ${UNKNOWN_OWNER}`);
  const deleteUnknownGroups = db.prepare(`DELETE FROM groups WHERE ${UNKNOWN_OWNER}`);

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

  const openGroupName = (row: GroupRow) => sealer.open<{ name: string }>(row.data, groupContext(row)).name;
  const openFields = (row: EntryRow) => sealer.open<EntryFields>(row.data, dataContext(row));
  const openTotp = (row: EntryRow) => (row.totp ? sealer.open<TotpParams>(row.totp, totpContext(row)) : null);

  function toGroup(row: GroupRow): Group {
    return {
      id: row.id,
      parentId: row.parent_id,
      name: openGroupName(row),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function toSummary(row: EntryRow, fields: EntryFields = openFields(row)): EntrySummary {
    return {
      id: row.id,
      groupId: row.group_id,
      title: fields.title,
      username: fields.username,
      url: fields.url,
      hasTotp: row.totp !== null,
      rev: row.rev,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    };
  }

  function toEntry(row: EntryRow): Entry {
    const fields = openFields(row);
    const params = openTotp(row);
    return {
      ...toSummary(row, fields),
      password: fields.password,
      notes: fields.notes,
      totp: params && totpInfo(params),
    };
  }

  function groupRow(owner: string, id: string): GroupRow {
    const row = selectGroup.get(id, owner) as GroupRow | undefined;
    if (!row) throw new VaultError(404, "No such group", "not-found");
    return row;
  }

  function entryRow(owner: string, id: string): EntryRow {
    const row = selectEntry.get(id, owner) as EntryRow | undefined;
    if (!row) throw new VaultError(404, "No such entry", "not-found");
    return row;
  }

  /** A group id from a request: null (top level) or one of the owner's groups. */
  function groupRef(owner: string, value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string" || !selectGroup.get(value, owner)) invalid("No such group");
    return value;
  }

  function writeEntry(
    row: EntryRow,
    changes: { groupId: string | null; fields: EntryFields; totp: Uint8Array | null; deletedAt: string | null },
  ): EntryRow {
    return updateEntryRow.get(
      changes.groupId,
      sealer.seal(changes.fields, dataContext(row)),
      changes.totp,
      changes.deletedAt,
      new Date().toISOString(),
      row.id,
      row.owner,
    ) as unknown as EntryRow;
  }

  function addEntry(
    owner: string,
    groupId: string | null,
    fields: EntryFields,
    params: TotpParams | null,
    times?: { createdAt: string; updatedAt: string },
  ): EntryRow {
    const id = randomUUID();
    const now = new Date().toISOString();
    const at = { owner, id };
    return insertEntry.get(
      id,
      owner,
      groupId,
      sealer.seal(fields, dataContext(at)),
      params && sealer.seal(params, totpContext(at)),
      times?.createdAt ?? now,
      times?.updatedAt ?? now,
    ) as unknown as EntryRow;
  }

  function addGroup(owner: string, parentId: string | null, name: string): GroupRow {
    const id = randomUUID();
    const now = new Date().toISOString();
    return insertGroup.get(
      id,
      owner,
      parentId,
      sealer.seal({ name }, groupContext({ owner, id })),
      now,
      now,
    ) as unknown as GroupRow;
  }

  return {
    /** Everything the page shows: groups, and entries without their secrets (recycle bin included). */
    load(owner: string): Vault {
      return {
        groups: (selectGroups.all(owner) as unknown as GroupRow[]).map(toGroup),
        entries: (selectEntries.all(owner) as unknown as EntryRow[]).map((row) => toSummary(row)),
      };
    },

    createGroup(owner: string, input: unknown): Group {
      const b = objectBody(input);
      return toGroup(addGroup(owner, groupRef(owner, b.parentId), groupName(b.name)));
    },

    /** Renames and/or moves a group. */
    updateGroup(owner: string, id: string, input: unknown): Group {
      const row = groupRow(owner, id);
      const b = objectBody(input);
      const name = b.name === undefined ? openGroupName(row) : groupName(b.name);
      let parentId = row.parent_id;
      if (b.parentId !== undefined) {
        parentId = groupRef(owner, b.parentId);
        // Walk up from the new parent: meeting the group itself means it would end up inside itself.
        for (let p = parentId; p; p = (selectGroup.get(p, owner) as GroupRow | undefined)?.parent_id ?? null) {
          if (p === id) invalid("A group can't go inside itself");
        }
      }
      const data = sealer.seal({ name }, groupContext(row));
      return toGroup(updateGroupRow.get(parentId, data, new Date().toISOString(), id, owner) as unknown as GroupRow);
    },

    /** Deletes a group that holds no subgroups and no entries (outside the recycle bin). */
    deleteGroup(owner: string, id: string): void {
      groupRow(owner, id);
      const n = (stmt: typeof countSubgroups) => (stmt.get(id, owner) as { n: number }).n;
      if (n(countSubgroups) > 0 || n(countLiveEntries) > 0) {
        throw new VaultError(
          409,
          "Only an empty group can be deleted. Move or delete what is in it first.",
          "not-empty",
        );
      }
      transaction(() => {
        releaseBinEntries.run(id, owner);
        deleteGroupRow.run(id, owner);
      });
    },

    getEntry(owner: string, id: string): Entry {
      return toEntry(entryRow(owner, id));
    },

    createEntry(owner: string, input: unknown): Entry {
      const b = objectBody(input);
      const groupId = groupRef(owner, b.groupId);
      const fields = { ...EMPTY_FIELDS, ...entryFields(b) };
      const params = b.totp === undefined || b.totp === null ? null : totpParams(b.totp);
      return toEntry(addEntry(owner, groupId, fields, params));
    },

    /** Changes the fields present in the request. With `rev`, refuses (409) if the entry changed since. */
    updateEntry(owner: string, id: string, input: unknown): Entry {
      const row = entryRow(owner, id);
      const b = objectBody(input);
      if (b.rev !== undefined) {
        if (!Number.isSafeInteger(b.rev)) invalid("rev must be a number");
        if (b.rev !== row.rev) {
          throw new VaultError(409, "This entry was changed somewhere else since you opened it.", "conflict");
        }
      }
      const groupId = b.groupId === undefined ? row.group_id : groupRef(owner, b.groupId);
      const fields = { ...openFields(row), ...entryFields(b) };
      // An unchanged TOTP keeps its sealed value as it is.
      let sealedTotp = row.totp;
      if (b.totp === null) sealedTotp = null;
      else if (b.totp !== undefined) sealedTotp = sealer.seal(totpParams(b.totp), totpContext(row));
      return toEntry(writeEntry(row, { groupId, fields, totp: sealedTotp, deletedAt: row.deleted_at }));
    },

    /** Moves an entry to the recycle bin. */
    deleteEntry(owner: string, id: string): EntrySummary {
      const row = entryRow(owner, id);
      if (row.deleted_at) return toSummary(row);
      const fields = openFields(row);
      const deletedAt = new Date().toISOString();
      return toSummary(writeEntry(row, { groupId: row.group_id, fields, totp: row.totp, deletedAt }), fields);
    },

    /** Takes an entry out of the recycle bin. */
    restoreEntry(owner: string, id: string): EntrySummary {
      const row = entryRow(owner, id);
      if (!row.deleted_at) return toSummary(row);
      const fields = openFields(row);
      return toSummary(writeEntry(row, { groupId: row.group_id, fields, totp: row.totp, deletedAt: null }), fields);
    },

    /** Deletes an entry for good. Only from the recycle bin, so one click never loses a password. */
    purgeEntry(owner: string, id: string): void {
      const row = entryRow(owner, id);
      if (!row.deleted_at) throw new VaultError(409, "Move the entry to the recycle bin first.", "not-in-bin");
      deleteEntryRow.run(id, owner);
    },

    /** The entry's current TOTP code. The secret itself never leaves the server here. */
    async totpCode(owner: string, id: string, now: number = Date.now()): Promise<TotpCode> {
      const params = openTotp(entryRow(owner, id));
      if (!params) throw new VaultError(404, "This entry has no TOTP", "not-found");
      return totp(params, now);
    },

    /** The entry's TOTP as an otpauth:// link, to set it up in another authenticator. */
    totpUri(owner: string, id: string): string {
      const params = openTotp(entryRow(owner, id));
      if (!params) throw new VaultError(404, "This entry has no TOTP", "not-found");
      return formatOtpauth(params);
    },

    /** Empties the recycle bin of entries deleted more than BIN_DAYS ago. Returns how many went. */
    purge(now: number = Date.now()): number {
      const before = new Date(now - BIN_DAYS * 24 * 60 * 60_000).toISOString();
      return Number(purgeBin.run(before).changes);
    },

    /**
     * Deletes for good the vault (groups and entries, recycle bin included) of every owner who
     * isn't in `known` (Heimdall's usernames), i.e. of users removed from Heimdall. Returns how
     * much each of them had.
     */
    removeUnknownOwners(known: ReadonlySet<string>): { owner: string; entries: number; groups: number }[] {
      const $known = JSON.stringify([...known]);
      return transaction(() => {
        const removed = countUnknownOwners.all({ $known }) as { owner: string; entries: number; groups: number }[];
        deleteUnknownEntries.run({ $known });
        deleteUnknownGroups.run({ $known });
        return removed;
      });
    },

    /** The whole vault in plain text (recycle bin left out). */
    exportAll(owner: string): ExportFile {
      const groups = selectGroups.all(owner) as unknown as GroupRow[];
      const byId = new Map(groups.map((g) => [g.id, g]));
      const names = new Map(groups.map((g) => [g.id, openGroupName(g)]));
      const pathOf = (id: string | null): string[] => {
        const path: string[] = [];
        for (let g = id ? byId.get(id) : undefined; g; g = g.parent_id ? byId.get(g.parent_id) : undefined) {
          path.unshift(names.get(g.id)!);
        }
        return path;
      };
      const entries: ExportEntry[] = (selectEntries.all(owner) as unknown as EntryRow[])
        .filter((row) => !row.deleted_at)
        .map((row) => {
          const params = openTotp(row);
          return {
            group: pathOf(row.group_id),
            ...openFields(row),
            totp: params && formatOtpauth(params),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          };
        });
      return {
        format: "janus",
        version: 1,
        exportedAt: new Date().toISOString(),
        groups: groups.map((g) => pathOf(g.id)),
        entries,
      };
    },

    /**
     * Adds an export file's groups and entries to the vault. Groups are matched by their path of
     * names, so importing into a vault that has the same groups fills them. An entry identical to
     * one already in its group is skipped, so importing the same file twice adds nothing.
     * Everything is checked before anything is written: a bad file changes nothing.
     */
    importAll(owner: string, input: unknown): ImportResult {
      const b = objectBody(input);
      if (b.format !== "janus" || b.version !== 1) invalid("This is not a Janus export file (format janus, version 1)");
      const path = (value: unknown, where: string): string[] => {
        if (!Array.isArray(value)) invalid(`${where}: the group must be a list of names`);
        try {
          return value.map(groupName);
        } catch (err) {
          if (err instanceof VaultError) invalid(`${where}: ${err.message}`);
          throw err;
        }
      };
      if (!Array.isArray(b.groups) || !Array.isArray(b.entries)) invalid("The file must have groups and entries lists");
      if (b.entries.length > LIMITS.importEntries)
        invalid(`At most ${LIMITS.importEntries} entries can be imported at once`);
      const groupPaths = b.groups.map((g, i) => path(g, `Group ${i + 1}`));
      const now = new Date().toISOString();
      const incoming = b.entries.map((e, i) => {
        const where = `Entry ${i + 1}`;
        try {
          const eb = objectBody(e);
          return {
            group: path(eb.group ?? [], where),
            fields: { ...EMPTY_FIELDS, ...entryFields(eb) },
            totp: eb.totp === undefined || eb.totp === null ? null : totpParams(eb.totp),
            times: { createdAt: isoOr(eb.createdAt, now), updatedAt: isoOr(eb.updatedAt, now) },
          };
        } catch (err) {
          if (err instanceof VaultError && !err.message.startsWith(where)) invalid(`${where}: ${err.message}`);
          throw err;
        }
      });

      return transaction(() => {
        const result: ImportResult = { groups: 0, entries: 0, skipped: 0 };
        // The owner's groups by path ("[\"Work\",\"Servers\"]" → id). With two groups of the
        // same name side by side, the first one wins.
        const groups = selectGroups.all(owner) as unknown as GroupRow[];
        const byId = new Map(groups.map((g) => [g.id, { row: g, name: openGroupName(g) }]));
        const idOf = new Map<string, string | null>([["[]", null]]);
        const keyOf = (id: string): string[] => {
          const g = byId.get(id)!;
          return [...(g.row.parent_id ? keyOf(g.row.parent_id) : []), g.name];
        };
        for (const g of groups) {
          const key = JSON.stringify(keyOf(g.id));
          if (!idOf.has(key)) idOf.set(key, g.id);
        }
        const ensure = (names: string[]): string | null => {
          const key = JSON.stringify(names);
          const known = idOf.get(key);
          if (known !== undefined) return known;
          const row = addGroup(owner, ensure(names.slice(0, -1)), names[names.length - 1]!);
          result.groups++;
          idOf.set(key, row.id);
          return row.id;
        };
        groupPaths.forEach(ensure);

        // What is already there, to skip exact copies.
        const fingerprint = (groupId: string | null, fields: EntryFields, params: TotpParams | null) =>
          JSON.stringify([groupId, ...FIELD_NAMES.map((f) => fields[f]), params && formatOtpauth(params)]);
        const existing = new Set(
          (selectEntries.all(owner) as unknown as EntryRow[])
            .filter((row) => !row.deleted_at)
            .map((row) => fingerprint(row.group_id, openFields(row), openTotp(row))),
        );
        for (const e of incoming) {
          const groupId = ensure(e.group);
          const print = fingerprint(groupId, e.fields, e.totp);
          if (existing.has(print)) {
            result.skipped++;
            continue;
          }
          existing.add(print);
          addEntry(owner, groupId, e.fields, e.totp, e.times);
          result.entries++;
        }
        return result;
      });
    },
  };
}

export type VaultStore = ReturnType<typeof createVault>;
