import express, { type ErrorRequestHandler, type Request } from "express";
import { heimdallAuth, knownUsers } from "@axis-suite/heimdall-client/server";
import { USER_HEADER, type ApiError } from "../shared/protocol.ts";
import { DB_FILE, openDatabase } from "./db.ts";
import { createEvents } from "./events.ts";
import { StoreError, createStore } from "./store.ts";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3010);

const db = openDatabase(DB_FILE);
console.log(`Time database: ${DB_FILE}`);
const store = createStore(db);

// The sessions of users removed from Heimdall go for good at start-up; the installer restarts this
// service when Heimdall's list of users changes. VACUUM gives the space back to the disk.
const known = knownUsers();
if (known) {
  const removed = store.removeUnknownOwners(known);
  for (const { owner, sessions, projects } of removed) {
    console.log(`Deleted ${sessions} sessions and ${projects} projects of ${owner}, who is no longer a Heimdall user`);
  }
  if (removed.length > 0) db.exec("VACUUM");
}

const auth = heimdallAuth();
const events = createEvents();

/** Tells every open tab of `owners` to ask again. */
const changed = (...owners: string[]) => events.send(owners, "changed", {});

const app = express();
app.disable("x-powered-by");

// Liveness check for the installer and monitoring. Every module answers it.
app.get("/healthz", (_req, res) => {
  res.type("text/plain").set("Cache-Control", "no-store").send("ok");
});

app.use("/api", auth.sameOriginWrites, auth.requireUser, (req, res, next) => {
  res.set("Cache-Control", "no-store");
  // A page names the user it belongs to. If someone else has signed in since (in another tab), it
  // must not show or change their sessions: 409 makes it reload as the new user. EventSource can't
  // send headers, so the event stream names its user in ?user=.
  const expected = req.get(USER_HEADER) ?? req.query.user;
  if (typeof expected === "string" && expected !== auth.user(req).username) {
    return void res.status(409).json({ error: "Someone else is signed in now", code: "other-user" } satisfies ApiError);
  }
  next();
});
// Bodies are read only once the user is known; the largest is a session's tags.
app.use(express.json({ limit: "64kb" }));

const owner = (req: Request) => auth.user(req).username;

// The signed-in user
app.get("/api/me", auth.me);

// Everything the timer shows: ?today= is the page's date, ?project= the project it shows too.
app.get("/api/state", (req, res) => {
  res.json(store.state(owner(req), req.query));
});

app.post("/api/sessions/start", (req, res) => {
  const user = owner(req);
  res.json(store.start(user, req.body));
  changed(user);
});
app.post("/api/sessions/stop", (req, res) => {
  const user = owner(req);
  res.json(store.stop(user));
  changed(user);
});

app.get("/api/sessions", (req, res) => {
  res.json(store.sessions(owner(req), req.query));
});
app.patch("/api/sessions/:id", (req, res) => {
  const user = owner(req);
  res.json(store.updateSession(user, req.params.id, req.body));
  changed(user);
});
app.delete("/api/sessions/:id", (req, res) => {
  const user = owner(req);
  store.deleteSession(user, req.params.id);
  res.status(204).end();
  changed(user);
});

app.get("/api/projects", (req, res) => {
  res.json(store.projects(owner(req), req.query));
});
app.patch("/api/projects/:id", (req, res) => {
  const user = owner(req);
  res.json(store.updateProject(user, req.params.id, req.body));
  changed(user);
});
app.delete("/api/projects/:id", (req, res) => {
  const user = owner(req);
  store.deleteProject(user, req.params.id);
  res.status(204).end();
  changed(user);
});

app.get("/api/tags", (req, res) => {
  res.json(store.tags(owner(req)));
});

// Every session, for a spreadsheet
app.get("/api/export.csv", (req, res) => {
  const csv = store.exportCsv(owner(req));
  res
    .attachment(`urd-${new Date().toISOString().slice(0, 10)}.csv`)
    .type("text/csv; charset=utf-8")
    .send(csv);
});

// Live updates: "changed" whenever this user's sessions or projects change, on any device
app.get("/api/events", (req, res) => {
  events.subscribe(owner(req), req, res);
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "No such API" } satisfies ApiError);
});

// Errors as JSON. StoreError is a refused request; express.json's own errors carry a status.
// Anything else is a bug: logged, and answered without details.
const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof StoreError) {
    return void res.status(err.status).json({ error: err.message, code: err.code } satisfies ApiError);
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
    // Event streams never end on their own, so they are closed first.
    events.closeAll();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
