// An entry being edited (or created), and what saving it sends.
import type { Entry, EntryCreate, EntryFields, EntryPatch, TotpInfo } from "../../shared/protocol.ts";

export const FIELD_NAMES = [
  "title",
  "username",
  "password",
  "url",
  "notes",
] as const satisfies readonly (keyof EntryFields)[];

export interface Draft {
  /** null for a new entry */
  id: string | null;
  /** the rev the editing started from */
  rev: number | null;
  groupId: string | null;
  fields: EntryFields;
  /** undefined: unchanged; null: remove it; a string: the otpauth:// link of a new one */
  totp: string | null | undefined;
  /** the TOTP the entry has now (without its secret) */
  totpInfo: TotpInfo | null;
  /** as the entry was when editing started, to send only what changed */
  original: { groupId: string | null; fields: EntryFields };
  /** set when saving found the entry changed somewhere else */
  conflict: boolean;
}

const EMPTY: EntryFields = { title: "", username: "", password: "", url: "", notes: "" };

export function newDraft(groupId: string | null): Draft {
  return {
    id: null,
    rev: null,
    groupId,
    fields: EMPTY,
    totp: undefined,
    totpInfo: null,
    original: { groupId, fields: EMPTY },
    conflict: false,
  };
}

export function draftOf(entry: Entry): Draft {
  const fields: EntryFields = {
    title: entry.title,
    username: entry.username,
    password: entry.password,
    url: entry.url,
    notes: entry.notes,
  };
  return {
    id: entry.id,
    rev: entry.rev,
    groupId: entry.groupId,
    fields,
    totp: undefined,
    totpInfo: entry.totp,
    original: { groupId: entry.groupId, fields },
    conflict: false,
  };
}

export function isDirty(d: Draft): boolean {
  return (
    d.totp !== undefined ||
    d.groupId !== d.original.groupId ||
    FIELD_NAMES.some((f) => d.fields[f] !== d.original.fields[f])
  );
}

export function createBody(d: Draft): EntryCreate {
  return {
    groupId: d.groupId,
    ...d.fields,
    title: d.fields.title.trim() || "Untitled",
    ...(d.totp ? { totp: d.totp } : {}),
  };
}

/**
 * Only what changed, with the rev it started from. After a conflict, `rev` is the entry's new rev:
 * the fields changed here then replace the ones changed elsewhere, and the rest keeps those.
 */
export function patchBody(d: Draft, rev: number | null = d.rev): EntryPatch {
  const body: EntryPatch = {};
  if (rev !== null) body.rev = rev;
  for (const f of FIELD_NAMES) if (d.fields[f] !== d.original.fields[f]) body[f] = d.fields[f];
  if (body.title !== undefined && !body.title.trim()) body.title = "Untitled";
  if (d.groupId !== d.original.groupId) body.groupId = d.groupId;
  if (d.totp !== undefined) body.totp = d.totp;
  return body;
}
