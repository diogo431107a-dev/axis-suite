import express, { type ErrorRequestHandler } from "express";
import { heimdallAuth, knownUsers } from "@axis-suite/heimdall-client/server";
import { USER_HEADER, type ApiError } from "../shared/protocol.ts";
import { DB_FILE, openDatabase } from "./db.ts";
import { StoreError, createStore } from "./store.ts";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3007);

const db = openDatabase(DB_FILE);
console.log(`Boards database: ${DB_FILE}`);
const store = createStore(db);

// The boards of users removed from Heimdall go for good at start-up; the installer restarts
// this service when Heimdall's list of users changes. VACUUM gives the space back to the disk.
const known = knownUsers();
if (known) {
  const removed = store.removeUnknownOwners(known);
  for (const { owner, cards } of removed) {
    console.log(`Deleted the boards (${cards} cards) of ${owner}, who is no longer a Heimdall user`);
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

app.use("/api", auth.sameOriginWrites, auth.requireUser, (req, res, next) => {
  res.set("Cache-Control", "no-store");
  // A page names the user whose boards it shows. If someone else has signed in since (in another
  // tab), its changes must not land on their boards: 409 makes it reload as the new user.
  const expected = req.get(USER_HEADER);
  if (expected !== undefined && expected !== auth.user(req).username) {
    return void res.status(409).json({ error: "Someone else is signed in now", code: "other-user" } satisfies ApiError);
  }
  next();
});
// Bodies are read only once the user is known. A restore sends a whole file; anything else is at
// most one card's fields (a 20,000-character description and a few short ones).
app.use("/api/restore", express.json({ limit: "32mb" }));
app.use(express.json({ limit: "1mb" }));

const owner = (req: express.Request) => auth.user(req).username;

// The signed-in user
app.get("/api/me", auth.me);

app.get("/api/boards", (req, res) => {
  res.json(store.boards(owner(req)));
});
app.post("/api/boards", (req, res) => {
  res.status(201).json(store.createBoard(owner(req), req.body));
});
app.get("/api/boards/:id", (req, res) => {
  res.json(store.board(owner(req), req.params.id));
});
app.patch("/api/boards/:id", (req, res) => {
  res.json(store.updateBoard(owner(req), req.params.id, req.body));
});
app.delete("/api/boards/:id", (req, res) => {
  store.deleteBoard(owner(req), req.params.id);
  res.status(204).end();
});
app.post("/api/boards/:id/move", (req, res) => {
  res.json(store.moveBoard(owner(req), req.params.id, req.body));
});
app.get("/api/boards/:id/export", (req, res) => {
  res.json(store.exportBoards(owner(req), req.params.id));
});

app.post("/api/lists", (req, res) => {
  res.status(201).json(store.createList(owner(req), req.body));
});
app.patch("/api/lists/:id", (req, res) => {
  res.json(store.updateList(owner(req), req.params.id, req.body));
});
app.delete("/api/lists/:id", (req, res) => {
  store.deleteList(owner(req), req.params.id);
  res.status(204).end();
});
app.post("/api/lists/:id/move", (req, res) => {
  res.json(store.moveList(owner(req), req.params.id, req.body));
});

app.post("/api/labels", (req, res) => {
  res.status(201).json(store.createLabel(owner(req), req.body));
});
app.patch("/api/labels/:id", (req, res) => {
  res.json(store.updateLabel(owner(req), req.params.id, req.body));
});
app.delete("/api/labels/:id", (req, res) => {
  store.deleteLabel(owner(req), req.params.id);
  res.status(204).end();
});

app.post("/api/cards", (req, res) => {
  res.status(201).json(store.createCard(owner(req), req.body));
});
app.get("/api/cards/:id", (req, res) => {
  res.json(store.card(owner(req), req.params.id));
});
app.patch("/api/cards/:id", (req, res) => {
  res.json(store.patchCard(owner(req), req.params.id, req.body));
});
app.delete("/api/cards/:id", (req, res) => {
  store.deleteCard(owner(req), req.params.id);
  res.status(204).end();
});
app.post("/api/cards/:id/move", (req, res) => {
  res.json(store.moveCard(owner(req), req.params.id, req.body));
});
app.post("/api/cards/:id/items", (req, res) => {
  res.status(201).json(store.createItem(owner(req), req.params.id, req.body));
});

app.patch("/api/items/:id", (req, res) => {
  res.json(store.updateItem(owner(req), req.params.id, req.body));
});
app.delete("/api/items/:id", (req, res) => {
  store.deleteItem(owner(req), req.params.id);
  res.status(204).end();
});
app.post("/api/items/:id/move", (req, res) => {
  res.json(store.moveItem(owner(req), req.params.id, req.body));
});

app.get("/api/export", (req, res) => {
  const file = store.exportBoards(owner(req));
  res.attachment(`valkyrie-${file.exportedAt.slice(0, 10)}.json`).json(file);
});
app.post("/api/restore", (req, res) => {
  res.json(store.restore(owner(req), req.body));
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "No such API" } satisfies ApiError);
});

// Errors as JSON. StoreError is a refused request; express.json's own errors carry a status.
// Anything else is a bug: logged, and answered without details.
const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof StoreError) {
    const body: ApiError = { error: err.message, code: err.code };
    if (err.card) body.card = err.card;
    return void res.status(err.status).json(body);
  }
  const status = (err as { status?: unknown }).status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return void res.status(status).json({ error: (err as Error).message } satisfies ApiError);
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server" } satisfies ApiError);
};
app.use(onError);

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
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
