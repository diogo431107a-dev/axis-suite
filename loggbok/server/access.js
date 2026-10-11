// Every read and write of notes goes through here, so this is the one place that decides
// who may see or change a note. Sharing will extend roleOf() and the VISIBLE filter.
import { randomUUID } from 'node:crypto';
import { db } from './db.js';

// Notes the user may see. With sharing this becomes:
//   owner = $user OR id IN (SELECT note_id FROM note_shares WHERE username = $user)
const VISIBLE = 'owner = $user';

/** The user's role on a note: 'owner', or null if they can't see it. Sharing adds 'editor' and 'viewer'. */
function roleOf(row, user) {
  return row.owner === user.username ? 'owner' : null;
}

export const canEdit = role => role === 'owner';
export const canDelete = role => role === 'owner';

const toNote = (r, role) => ({
  id: r.id,
  owner: r.owner,
  role,
  title: r.title,
  content: r.content,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function listNotes(user, q) {
  const rows = q
    ? db.prepare(
        `SELECT * FROM notes WHERE ${VISIBLE} AND (title LIKE $q OR content LIKE $q) ORDER BY updated_at DESC`
      ).all({ $user: user.username, $q: `%${q}%` })
    : db.prepare(
        `SELECT * FROM notes WHERE ${VISIBLE} ORDER BY updated_at DESC`
      ).all({ $user: user.username });
  return rows.map(r => toNote(r, roleOf(r, user)));
}

/** The note and the user's role on it, or null if it doesn't exist or they can't see it. */
export function findNote(id, user) {
  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
  const role = row ? roleOf(row, user) : null;
  return role ? { note: toNote(row, role), role } : null;
}

export function createNote(user, { title, content }) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO notes (id, owner, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, user.username, title, content, now, now);
  return findNote(id, user).note;
}

// Callers check canEdit / canDelete first.
export function updateNote(id, user, { title, content }) {
  db.prepare(
    'UPDATE notes SET title = ?, content = ?, updated_at = ? WHERE id = ?'
  ).run(title, content, new Date().toISOString(), id);
  return findNote(id, user).note;
}

export function deleteNote(id) {
  db.prepare('DELETE FROM notes WHERE id = ?').run(id);
}
