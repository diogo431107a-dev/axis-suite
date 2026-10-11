import express from 'express';
import { HEIMDALL_PUBLIC_URL, requireUser, sameOriginWrites } from './auth.js';
import {
  canDelete, canEdit, createNote, deleteNote, findNote, listNotes, updateNote,
} from './access.js';

const app = express();
app.use(express.json());
app.use('/api', sameOriginWrites, requireUser);

const NOT_FOUND = { error: 'Note not found' };

// Title and content from a request body, or null if they aren't strings.
function noteFields(body) {
  const { title, content } = body ?? {};
  return typeof title === 'string' && typeof content === 'string' ? { title, content } : null;
}

// The signed-in user
app.get('/api/me', (req, res) => {
  res.json({ ...req.user, accountUrl: HEIMDALL_PUBLIC_URL });
});

// List / search
app.get('/api/notes', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  res.json(listNotes(req.user, q));
});

// Create
app.post('/api/notes', (req, res) => {
  const fields = noteFields(req.body);
  if (!fields) return res.status(400).json({ error: 'title and content must be strings' });
  res.status(201).json(createNote(req.user, fields));
});

// Update
app.put('/api/notes/:id', (req, res) => {
  const fields = noteFields(req.body);
  if (!fields) return res.status(400).json({ error: 'title and content must be strings' });
  const found = findNote(req.params.id, req.user);
  if (!found) return res.status(404).json(NOT_FOUND);
  if (!canEdit(found.role)) return res.status(403).json({ error: 'You can only read this note' });
  res.json(updateNote(req.params.id, req.user, fields));
});

// Delete
app.delete('/api/notes/:id', (req, res) => {
  const found = findNote(req.params.id, req.user);
  if (!found) return res.status(404).json(NOT_FOUND);
  if (!canDelete(found.role)) return res.status(403).json({ error: 'Only the owner can delete this note' });
  deleteNote(req.params.id);
  res.status(204).end();
});

const HOST = process.env.HOST || '127.0.0.1';
const PORT = process.env.PORT || 3001;
app.listen(PORT, HOST, () => console.log(`API listening on http://${HOST}:${PORT}`));
