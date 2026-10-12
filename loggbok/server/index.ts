import express from "express";
import { heimdallAuth } from "@axis-suite/heimdall-client/server";
import {
  canDelete,
  canEdit,
  createNote,
  deleteNote,
  findNote,
  listNotes,
  updateNote,
  type NoteFields,
} from "./access.ts";
import { db } from "./db.ts";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3001);

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

// The signed-in user
app.get("/api/me", auth.me);

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

// Update
app.put("/api/notes/:id", (req, res) => {
  const fields = noteFields(req.body);
  if (!fields) return void res.status(400).json({ error: "title and content must be strings" });
  const found = findNote(req.params.id, auth.user(req));
  if (!found) return void res.status(404).json(NOT_FOUND);
  if (!canEdit(found.role)) return void res.status(403).json({ error: "You can only read this note" });
  res.json(updateNote(req.params.id, auth.user(req), fields));
});

// Delete
app.delete("/api/notes/:id", (req, res) => {
  const found = findNote(req.params.id, auth.user(req));
  if (!found) return void res.status(404).json(NOT_FOUND);
  if (!canDelete(found.role)) return void res.status(403).json({ error: "Only the owner can delete this note" });
  deleteNote(req.params.id);
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
