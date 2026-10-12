import express, { type ErrorRequestHandler } from "express";
import { heimdallAuth, knownUsers } from "@axis-suite/heimdall-client/server";
import { USER_HEADER, type ApiError } from "../shared/protocol.ts";
import { DB_FILE, openDatabase } from "./db.ts";
import { StoreError, createStore } from "./store.ts";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3004);

const db = openDatabase(DB_FILE);
console.log(`Journal database: ${DB_FILE}`);
const store = createStore(db);

// The journals of users removed from Heimdall go for good at start-up; the installer restarts
// this service when Heimdall's list of users changes. VACUUM gives the space back to the disk.
const known = knownUsers();
if (known) {
  const removed = store.removeUnknownOwners(known);
  for (const { owner, journals, pages } of removed) {
    console.log(`Deleted ${journals} journals and ${pages} pages of ${owner}, who is no longer a Heimdall user`);
  }
  if (removed.length > 0) db.exec("VACUUM");
}

// Journals in the recycle bin go for good after 30 days: checked now and once a day.
function purge() {
  const purged = store.purge();
  if (purged > 0) console.log(`Purged ${purged} journals from the recycle bin`);
}
purge();
setInterval(purge, 24 * 60 * 60_000).unref();

const auth = heimdallAuth();
const app = express();
app.disable("x-powered-by");

// Liveness check for the installer and monitoring. Every module answers it.
app.get("/healthz", (_req, res) => {
  res.type("text/plain").set("Cache-Control", "no-store").send("ok");
});

app.use("/api", auth.sameOriginWrites, auth.requireUser, (req, res, next) => {
  res.set("Cache-Control", "no-store");
  // A page names the user whose journals it shows. If someone else has signed in since (in
  // another tab), its changes must not land in their journals: 409 makes it reload as the new user.
  const expected = req.get(USER_HEADER);
  if (expected !== undefined && expected !== auth.user(req).username) {
    return void res.status(409).json({ error: "Someone else is signed in now", code: "other-user" } satisfies ApiError);
  }
  next();
});
// Bodies are read only once the user is known. An import sends every journal at once; anything
// else is at most one page (200,000 characters, up to 4 bytes each in JSON).
app.use("/api/import", express.json({ limit: "64mb" }));
app.use(express.json({ limit: "2mb" }));

const owner = (req: express.Request) => auth.user(req).username;

// The signed-in user
app.get("/api/me", auth.me);

app.get("/api/journals", (req, res) => {
  res.json(store.journals(owner(req)));
});
app.post("/api/journals", (req, res) => {
  res.status(201).json(store.createJournal(owner(req), req.body));
});
// The order of the sidebar: every journal id, in order.
app.put("/api/journals/order", (req, res) => {
  res.json(store.orderJournals(owner(req), req.body));
});
app.patch("/api/journals/:id", (req, res) => {
  res.json(store.updateJournal(owner(req), req.params.id, req.body));
});
// To the recycle bin; with ?purge=1, out of it for good.
app.delete("/api/journals/:id", (req, res) => {
  if (req.query.purge === "1") {
    store.purgeJournal(owner(req), req.params.id);
    return void res.status(204).end();
  }
  res.json(store.deleteJournal(owner(req), req.params.id));
});
app.post("/api/journals/:id/restore", (req, res) => {
  res.json(store.restoreJournal(owner(req), req.params.id));
});

app.get("/api/pages/:journalId/:date", (req, res) => {
  res.json(store.getPage(owner(req), req.params.journalId, req.params.date));
});
app.put("/api/pages/:journalId/:date", (req, res) => {
  res.json(store.putPage(owner(req), req.params.journalId, req.params.date, req.body));
});

app.get("/api/days", (req, res) => {
  res.json(store.days(owner(req), req.query));
});
app.get("/api/on-this-day", (req, res) => {
  res.json(store.onThisDay(owner(req), req.query));
});
app.get("/api/streak", (req, res) => {
  res.json(store.streak(owner(req), req.query));
});
app.get("/api/tags", (req, res) => {
  res.json(store.tags(owner(req)));
});
app.get("/api/search", (req, res) => {
  res.json(store.search(owner(req), req.query));
});

app.get("/api/templates", (req, res) => {
  res.json(store.templates(owner(req)));
});
app.post("/api/templates", (req, res) => {
  res.status(201).json(store.createTemplate(owner(req), req.body));
});
app.patch("/api/templates/:id", (req, res) => {
  res.json(store.updateTemplate(owner(req), req.params.id, req.body));
});
app.delete("/api/templates/:id", (req, res) => {
  store.deleteTemplate(owner(req), req.params.id);
  res.status(204).end();
});

app.get("/api/settings", (req, res) => {
  res.json(store.settings(owner(req)));
});
app.put("/api/settings", (req, res) => {
  res.json(store.putSettings(owner(req), req.body));
});

app.get("/api/export", (req, res) => {
  const file = store.exportAll(owner(req));
  res.attachment(`papyrus-${file.exportedAt.slice(0, 10)}.json`).json(file);
});
app.post("/api/import", (req, res) => {
  res.json(store.importAll(owner(req), req.body));
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "No such API" } satisfies ApiError);
});

// Errors as JSON. StoreError is a refused request; express.json's own errors carry a status.
// Anything else is a bug: logged, and answered without details.
const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof StoreError) {
    const body: ApiError = { error: err.message, code: err.code };
    if (err.page) body.page = err.page;
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
