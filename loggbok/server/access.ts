// Every read and write of notes goes through here, so this is the one place that decides
// who may see or change a note: its owner, and the people it is shared with.
import { randomUUID } from "node:crypto";
import type { HeimdallUser } from "@axis-suite/heimdall-client/server";
import { db } from "./db.ts";

/** The signed-in user's access to a note: theirs, shared with them to edit, or to read. */
export type Role = "owner" | "editor" | "viewer";

export type Permission = "read" | "write";

/** Someone a note is shared with. */
export interface Share {
  /** Heimdall username. */
  username: string;
  permission: Permission;
}

/** A note as the list shows it: the start of its content instead of all of it. */
export interface NoteSummary {
  id: string;
  /** Heimdall username of the note's owner. */
  owner: string;
  role: Role;
  /** Shared with anyone at all. */
  shared: boolean;
  title: string;
  /** The first PREVIEW_CHARS characters of the content. */
  preview: string;
  createdAt: string;
  updatedAt: string;
}

export interface Note extends NoteSummary {
  content: string;
  /** Who it is shared with. Only its owner gets this. */
  shares?: Share[];
}

export interface NoteFields {
  title: string;
  content: string;
}

interface SummaryRow {
  id: string;
  owner: string;
  title: string;
  preview: string;
  created_at: string;
  updated_at: string;
  /** The signed-in user's permission, if the note is shared with them. */
  shared_as: Permission | null;
  shared: number;
}

interface NoteRow extends SummaryRow {
  content: string;
}

// The list only shows a line of each note, so it gets this much of the content, not all of it.
const PREVIEW_CHARS = 160;
const PREVIEW = `substr(content, 1, ${PREVIEW_CHARS}) AS preview`;
const SHARED = "EXISTS (SELECT 1 FROM note_shares WHERE note_id = notes.id) AS shared";

// Each note with the signed-in user's share of it, if any.
const NOTES_FOR_USER = "notes LEFT JOIN note_shares s ON s.note_id = notes.id AND s.username = $user";
// Notes the user may see: their own, and those shared with them.
const VISIBLE = "(owner = $user OR s.permission IS NOT NULL)";

/** The user's role on a note, or null if they can't see it. */
function roleOf(row: Pick<SummaryRow, "owner" | "shared_as">, user: HeimdallUser): Role | null {
  if (row.owner === user.username) return "owner";
  if (row.shared_as === "write") return "editor";
  if (row.shared_as === "read") return "viewer";
  return null;
}

export const canEdit = (role: Role) => role !== "viewer";
export const canDelete = (role: Role) => role === "owner";
export const canShare = (role: Role) => role === "owner";

const toSummary = (r: SummaryRow, role: Role): NoteSummary => ({
  id: r.id,
  owner: r.owner,
  role,
  shared: Boolean(r.shared),
  title: r.title,
  preview: r.preview,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toNote = (r: NoteRow, role: Role): Note => ({
  ...toSummary(r, role),
  content: r.content,
  ...(canShare(role) && { shares: listShares(r.id) }),
});

// Compiled once, when the module loads.
const SUMMARY_COLUMNS = `notes.id, owner, title, ${PREVIEW}, created_at, updated_at, s.permission AS shared_as, ${SHARED}`;
const listAll = db.prepare(
  `SELECT ${SUMMARY_COLUMNS} FROM ${NOTES_FOR_USER} WHERE ${VISIBLE} ORDER BY updated_at DESC`,
);
const listMatching = db.prepare(
  `SELECT ${SUMMARY_COLUMNS} FROM ${NOTES_FOR_USER}
   WHERE ${VISIBLE} AND (title LIKE $q OR content LIKE $q) ORDER BY updated_at DESC`,
);
const selectNote = db.prepare(
  `SELECT notes.*, ${PREVIEW}, s.permission AS shared_as, ${SHARED} FROM ${NOTES_FOR_USER} WHERE notes.id = $id`,
);
const insertNote = db.prepare(
  `INSERT INTO notes (id, owner, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
   RETURNING *, ${PREVIEW}, NULL AS shared_as, 0 AS shared`,
);
// With $base, only if nobody has saved the note since that version.
const updateNoteRow = db.prepare(
  `UPDATE notes SET title = $title, content = $content, updated_at = $now
   WHERE id = $id AND ($base IS NULL OR updated_at = $base) RETURNING *, ${PREVIEW}, ${SHARED}`,
);
const deleteNoteRow = db.prepare("DELETE FROM notes WHERE id = ?");
const selectShares = db.prepare("SELECT username, permission FROM note_shares WHERE note_id = ? ORDER BY username");
const insertShare = db.prepare("INSERT INTO note_shares (note_id, username, permission) VALUES (?, ?, ?)");
const deleteShares = db.prepare("DELETE FROM note_shares WHERE note_id = ?");
const deleteShare = db.prepare("DELETE FROM note_shares WHERE note_id = ? AND username = ?");
// $known: a JSON array of usernames.
const UNKNOWN_OWNER = "owner NOT IN (SELECT value FROM json_each($known))";
const countUnknownOwners = db.prepare(
  `SELECT owner, count(*) AS rows FROM notes WHERE ${UNKNOWN_OWNER} GROUP BY owner ORDER BY owner`,
);
const deleteUnknownOwners = db.prepare(`DELETE FROM notes WHERE ${UNKNOWN_OWNER}`);
const deleteUnknownShares = db.prepare(
  "DELETE FROM note_shares WHERE username NOT IN (SELECT value FROM json_each($known))",
);

// Runs fn in one transaction that no other writer can interleave with.
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

export function listNotes(user: HeimdallUser, q: string): NoteSummary[] {
  const rows = (q
    ? listMatching.all({ $user: user.username, $q: `%${q}%` })
    : listAll.all({ $user: user.username })) as unknown as SummaryRow[];
  return rows.flatMap((r) => {
    const role = roleOf(r, user);
    return role ? [toSummary(r, role)] : [];
  });
}

/** The note and the user's role on it, or null if it doesn't exist or they can't see it. */
export function findNote(id: string, user: HeimdallUser): { note: Note; role: Role } | null {
  const row = selectNote.get({ $id: id, $user: user.username }) as NoteRow | undefined;
  const role = row ? roleOf(row, user) : null;
  return row && role ? { note: toNote(row, role), role } : null;
}

export function createNote(user: HeimdallUser, { title, content }: NoteFields): Note {
  const now = new Date().toISOString();
  const row = insertNote.get(randomUUID(), user.username, title, content, now, now) as unknown as NoteRow;
  return toNote(row, "owner");
}

/**
 * Saves the note, or returns null when `baseUpdatedAt` is given and someone has saved it since
 * that version. `role` is the user's, from findNote. Callers check canEdit first.
 */
export function updateNote(
  id: string,
  role: Role,
  { title, content }: NoteFields,
  baseUpdatedAt: string | null,
): Note | null {
  const row = updateNoteRow.get({
    $id: id,
    $title: title,
    $content: content,
    $now: new Date().toISOString(),
    $base: baseUpdatedAt,
  }) as NoteRow | undefined;
  return row ? toNote(row, role) : null;
}

// Callers check canDelete first.
export function deleteNote(id: string): void {
  deleteNoteRow.run(id);
}

export function listShares(noteId: string): Share[] {
  return selectShares.all(noteId) as unknown as Share[];
}

/** Replaces everyone the note is shared with. Callers check canShare and the usernames first. */
export function setShares(noteId: string, shares: readonly Share[]): Share[] {
  return transaction(() => {
    deleteShares.run(noteId);
    for (const { username, permission } of shares) insertShare.run(noteId, username, permission);
    return listShares(noteId);
  });
}

/** Stops sharing the note with one person. False if it wasn't shared with them. */
export function removeShare(noteId: string, username: string): boolean {
  return Number(deleteShare.run(noteId, username).changes) > 0;
}

/**
 * Deletes for good the notes of every owner who isn't in `known` (Heimdall's usernames), i.e.
 * of users removed from Heimdall, and stops sharing notes with them. Returns how many notes
 * each of them had.
 */
export function removeUnknownOwners(known: ReadonlySet<string>): { owner: string; rows: number }[] {
  const $known = JSON.stringify([...known]);
  return transaction(() => {
    const removed = countUnknownOwners.all({ $known }) as { owner: string; rows: number }[];
    deleteUnknownOwners.run({ $known });
    deleteUnknownShares.run({ $known });
    return removed;
  });
}
