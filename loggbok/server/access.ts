// Every read and write of notes goes through here, so this is the one place that decides
// who may see or change a note. Sharing will extend roleOf() and the VISIBLE filter.
import { randomUUID } from "node:crypto";
import type { HeimdallUser } from "@axis-suite/heimdall-client/server";
import { db } from "./db.ts";

/** The signed-in user's access to a note. Sharing will add 'editor' and 'viewer'. */
export type Role = "owner";

/** A note as the list shows it: the start of its content instead of all of it. */
export interface NoteSummary {
  id: string;
  /** Heimdall username of the note's owner. */
  owner: string;
  role: Role;
  title: string;
  /** The first PREVIEW_CHARS characters of the content. */
  preview: string;
  createdAt: string;
  updatedAt: string;
}

export interface Note extends NoteSummary {
  content: string;
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
}

interface NoteRow extends SummaryRow {
  content: string;
}

// The list only shows a line of each note, so it gets this much of the content, not all of it.
const PREVIEW_CHARS = 160;
const PREVIEW = `substr(content, 1, ${PREVIEW_CHARS}) AS preview`;

// Notes the user may see. With sharing this becomes:
//   owner = $user OR id IN (SELECT note_id FROM note_shares WHERE username = $user)
const VISIBLE = "owner = $user";

/** The user's role on a note, or null if they can't see it. */
function roleOf(row: { owner: string }, user: HeimdallUser): Role | null {
  return row.owner === user.username ? "owner" : null;
}

export const canEdit = (role: Role) => role === "owner";
export const canDelete = (role: Role) => role === "owner";

const toSummary = (r: SummaryRow, role: Role): NoteSummary => ({
  id: r.id,
  owner: r.owner,
  role,
  title: r.title,
  preview: r.preview,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toNote = (r: NoteRow, role: Role): Note => ({ ...toSummary(r, role), content: r.content });

// Compiled once, when the module loads.
const SUMMARY_COLUMNS = `id, owner, title, ${PREVIEW}, created_at, updated_at`;
const listAll = db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM notes WHERE ${VISIBLE} ORDER BY updated_at DESC`);
const listMatching = db.prepare(
  `SELECT ${SUMMARY_COLUMNS} FROM notes WHERE ${VISIBLE} AND (title LIKE $q OR content LIKE $q) ORDER BY updated_at DESC`,
);
const selectNote = db.prepare(`SELECT *, ${PREVIEW} FROM notes WHERE id = ?`);
const insertNote = db.prepare(
  `INSERT INTO notes (id, owner, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *, ${PREVIEW}`,
);
const updateNoteRow = db.prepare(
  `UPDATE notes SET title = ?, content = ?, updated_at = ? WHERE id = ? RETURNING *, ${PREVIEW}`,
);
const deleteNoteRow = db.prepare("DELETE FROM notes WHERE id = ?");
// $known: a JSON array of usernames.
const UNKNOWN_OWNER = "owner NOT IN (SELECT value FROM json_each($known))";
const countUnknownOwners = db.prepare(
  `SELECT owner, count(*) AS rows FROM notes WHERE ${UNKNOWN_OWNER} GROUP BY owner ORDER BY owner`,
);
const deleteUnknownOwners = db.prepare(`DELETE FROM notes WHERE ${UNKNOWN_OWNER}`);

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
  const row = selectNote.get(id) as NoteRow | undefined;
  const role = row ? roleOf(row, user) : null;
  return row && role ? { note: toNote(row, role), role } : null;
}

export function createNote(user: HeimdallUser, { title, content }: NoteFields): Note {
  const now = new Date().toISOString();
  const row = insertNote.get(randomUUID(), user.username, title, content, now, now) as unknown as NoteRow;
  return toNote(row, roleOf(row, user)!);
}

// Callers check canEdit / canDelete first.
export function updateNote(id: string, user: HeimdallUser, { title, content }: NoteFields): Note {
  const row = updateNoteRow.get(title, content, new Date().toISOString(), id) as unknown as NoteRow;
  return toNote(row, roleOf(row, user)!);
}

export function deleteNote(id: string): void {
  deleteNoteRow.run(id);
}

/**
 * Deletes for good the notes of every owner who isn't in `known` (Heimdall's usernames), i.e.
 * of users removed from Heimdall. Returns how many notes each of them had.
 */
export function removeUnknownOwners(known: ReadonlySet<string>): { owner: string; rows: number }[] {
  const $known = JSON.stringify([...known]);
  db.exec("BEGIN IMMEDIATE");
  try {
    const removed = countUnknownOwners.all({ $known }) as { owner: string; rows: number }[];
    deleteUnknownOwners.run({ $known });
    db.exec("COMMIT");
    return removed;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
