import express from "express";
import { heimdallAuth, knownUsers } from "@axis-suite/heimdall-client/server";
import {
  canDelete,
  canEdit,
  canShare,
  createNote,
  deleteNote,
  findNote,
  listNotes,
  removeShare,
  removeUnknownOwners,
  setShares,
  updateNote,
  type NoteFields,
  type Share,
} from "./access.ts";
import { db } from "./db.ts";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3001);

// Notes of users removed from Heimdall go for good at start-up; the installer restarts this
// service when Heimdall's list of users changes. VACUUM gives the space back to the disk.
const known = knownUsers();
if (known) {
  const removed = removeUnknownOwners(known);
  for (const { owner, rows } of removed) {
    console.log(`Deleted ${rows} notes of ${owner}, who is no longer a Heimdall user`);
  }
  if (removed.length > 0) db.exec("VACUUM");
}

const auth = heimdallAuth();
const app = express();
app.disable("x-powered-by");

// Liveness check for the installer and monitoring. Every module answers it.
app.get("/healthz", (_req, res) => {
  res.type("text/plain").set("Cache-Control", "no-store").send("ok");
});

app.use(express.json());
app.use("/api", auth.sameOriginWrites, auth.requireUser);

const NOT_FOUND = { error: "Note not found" };

// Title and content from a request body, or null if they aren't strings.
function noteFields(body: unknown): NoteFields | null {
  const { title, content } = (body ?? {}) as Partial<Record<keyof NoteFields, unknown>>;
  return typeof title === "string" && typeof content === "string" ? { title, content } : null;
}

// The people a note may be shared with: every Heimdall user but its owner.
function sharableUsers(owner: string): string[] {
  return [...(known ?? [])].filter((username) => username !== owner).sort();
}

// The share list from a request body, or the reason it can't be accepted.
function shareList(body: unknown, owner: string): Share[] | string {
  if (!known) return "Loggbok doesn't know the suite's users, so it can't share notes";
  if (!Array.isArray(body)) return "Expected a list of { username, permission }";
  const shares: Share[] = [];
  const seen = new Set<string>();
  for (const item of body as unknown[]) {
    const { username, permission } = (item ?? {}) as Partial<Record<keyof Share, unknown>>;
    if (typeof username !== "string" || !known.has(username)) return `Not a user: ${String(username)}`;
    if (username === owner) return "A note can't be shared with its owner";
    if (seen.has(username)) return `Listed twice: ${username}`;
    if (permission !== "read" && permission !== "write") return "permission must be 'read' or 'write'";
    seen.add(username);
    shares.push({ username, permission });
  }
  return shares;
}

// The signed-in user
app.get("/api/me", auth.me);

// The users the signed-in user can share notes with
app.get("/api/users", (req, res) => {
  res.json(sharableUsers(auth.user(req).username));
});

// List / search. Each note comes with a preview of its content; GET /api/notes/:id has all of it.
app.get("/api/notes", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  res.json(listNotes(auth.user(req), q));
});

// Read one note
app.get("/api/notes/:id", (req, res) => {
  const found = findNote(req.params.id, auth.user(req));
  if (!found) return void res.status(404).json(NOT_FOUND);
  res.json(found.note);
});

// Create
app.post("/api/notes", (req, res) => {
  const fields = noteFields(req.body);
  if (!fields) return void res.status(400).json({ error: "title and content must be strings" });
  res.status(201).json(createNote(auth.user(req), fields));
});

// Update. With baseUpdatedAt (the version the editor started from), a note someone else has
// saved since answers 409 with that newer version instead of overwriting it.
app.put("/api/notes/:id", (req, res) => {
  const fields = noteFields(req.body);
  if (!fields) return void res.status(400).json({ error: "title and content must be strings" });
  const { baseUpdatedAt } = req.body as { baseUpdatedAt?: unknown };
  if (baseUpdatedAt !== undefined && typeof baseUpdatedAt !== "string") {
    return void res.status(400).json({ error: "baseUpdatedAt must be a string" });
  }
  const found = findNote(req.params.id, auth.user(req));
  if (!found) return void res.status(404).json(NOT_FOUND);
  if (!canEdit(found.role)) return void res.status(403).json({ error: "You can only read this note" });
  const updated = updateNote(req.params.id, found.role, fields, baseUpdatedAt ?? null);
  if (updated) return void res.json(updated);
  const current = findNote(req.params.id, auth.user(req));
  if (!current) return void res.status(404).json(NOT_FOUND);
  res.status(409).json({ error: "Someone else has changed this note", note: current.note });
});

// Delete
app.delete("/api/notes/:id", (req, res) => {
  const found = findNote(req.params.id, auth.user(req));
  if (!found) return void res.status(404).json(NOT_FOUND);
  if (!canDelete(found.role)) return void res.status(403).json({ error: "Only the owner can delete this note" });
  deleteNote(req.params.id);
  res.status(204).end();
});

// Share: replace everyone the note is shared with
app.put("/api/notes/:id/shares", (req, res) => {
  const found = findNote(req.params.id, auth.user(req));
  if (!found) return void res.status(404).json(NOT_FOUND);
  if (!canShare(found.role)) return void res.status(403).json({ error: "Only the owner can share this note" });
  const shares = shareList(req.body, found.note.owner);
  if (typeof shares === "string") return void res.status(400).json({ error: shares });
  res.json(setShares(req.params.id, shares));
});

// Stop sharing with one person. The owner can remove anyone; anyone can remove themselves.
app.delete("/api/notes/:id/shares/:username", (req, res) => {
  const user = auth.user(req);
  const found = findNote(req.params.id, user);
  if (!found) return void res.status(404).json(NOT_FOUND);
  if (!canShare(found.role) && req.params.username !== user.username) {
    return void res.status(403).json({ error: "Only the owner can change who sees this note" });
  }
  if (!removeShare(req.params.id, req.params.username)) {
    return void res.status(404).json({ error: "The note isn't shared with them" });
  }
  res.status(204).end();
});

// Express 5 hands a failure to listen (e.g. the port is taken) to this callback. Exiting with an
// error lets systemd see it (Restart=on-failure) instead of a quiet, successful exit.
const server = app.listen(PORT, HOST, (err) => {
  if (err) {
    console.error(`Could not listen on ${HOST}:${PORT}: ${err.message}`);
    process.exit(1);
  }
  console.log(`Listening on http://${HOST}:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
}
