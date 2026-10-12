// The API's wire format: what the server sends and accepts, and the limits it enforces.
// Uses no Node or DOM APIs, so both the server and the page import it.

import type { TotpAlgorithm } from "./totp.ts";

/** Sent with every request: the user the page belongs to. The API answers 409 if someone else is signed in. */
export const USER_HEADER = "X-Janus-User";

export const LIMITS = {
  groupNameChars: 200,
  titleChars: 500,
  usernameChars: 1000,
  passwordChars: 10_000,
  urlChars: 4000,
  notesChars: 100_000,
  totpInputChars: 2000,
  /** entries in one import */
  importEntries: 20_000,
} as const;

/** How long a deleted entry stays in the recycle bin. */
export const BIN_DAYS = 30;

export interface Group {
  id: string;
  /** null = top level */
  parentId: string | null;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** The fields of an entry that people type. */
export interface EntryFields {
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
}

/** An entry as the vault lists it: no password, notes or TOTP secret. */
export interface EntrySummary {
  id: string;
  /** null = top level */
  groupId: string | null;
  title: string;
  username: string;
  url: string;
  hasTotp: boolean;
  /** goes up by one with every change; PATCH sends it back to detect edits made elsewhere */
  rev: number;
  createdAt: string;
  updatedAt: string;
  /** set while the entry is in the recycle bin */
  deletedAt: string | null;
}

/** A TOTP's settings, without its secret. */
export interface TotpInfo {
  issuer: string;
  label: string;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
}

/** A whole entry, as GET /api/entries/:id, POST and PATCH answer. */
export interface Entry extends EntrySummary {
  password: string;
  notes: string;
  totp: TotpInfo | null;
}

/** GET /api/vault */
export interface Vault {
  groups: Group[];
  /** recycle bin included (deletedAt set) */
  entries: EntrySummary[];
}

/** POST /api/groups */
export interface GroupCreate {
  name: string;
  parentId: string | null;
}

/** PATCH /api/groups/:id: rename and/or move */
export type GroupPatch = Partial<GroupCreate>;

/** POST /api/entries */
export interface EntryCreate extends Partial<EntryFields> {
  groupId: string | null;
  /** an otpauth:// link or a bare base32 secret */
  totp?: string | null;
}

/** PATCH /api/entries/:id: only the fields that are present change. */
export interface EntryPatch extends Partial<EntryFields> {
  groupId?: string | null;
  /** an otpauth:// link or a bare secret sets the TOTP; null removes it */
  totp?: string | null;
  /** the rev the page edited; 409 { code: "conflict" } if the entry changed since */
  rev?: number;
}

export type ErrorCode = "invalid" | "not-found" | "conflict" | "not-empty" | "other-user" | "not-in-bin";

/** Every error answer: a sentence for people and, for the ones a page reacts to, a code. */
export interface ApiError {
  error: string;
  code?: ErrorCode;
}

/** GET /api/export, POST /api/import: a whole vault in plain text. */
export interface ExportFile {
  format: "janus";
  version: 1;
  exportedAt: string;
  /** every group, by its path of names from the top: ["Work", "Servers"] */
  groups: string[][];
  entries: ExportEntry[];
}

export interface ExportEntry extends EntryFields {
  /** path of the entry's group; [] = top level */
  group: string[];
  /** otpauth:// link, or null */
  totp: string | null;
  createdAt: string;
  updatedAt: string;
}

/** POST /api/import answers how much it added. */
export interface ImportResult {
  groups: number;
  entries: number;
  /** entries already in the vault, exactly the same in every field */
  skipped: number;
}
