import express, { type ErrorRequestHandler } from "express";
import { heimdallAuth, knownUsers } from "@axis-suite/heimdall-client/server";
import { USER_HEADER, type ApiError } from "../shared/protocol.ts";
import { DB_FILE, openDatabase } from "./db.ts";
import { StoreError, createStore } from "./store.ts";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3005);

const db = openDatabase(DB_FILE);
console.log(`Contacts database: ${DB_FILE}`);
const store = createStore(db);

// The contacts of users removed from Heimdall go for good at start-up; the installer restarts
// this service when Heimdall's list of users changes. VACUUM gives the space back to the disk.
const known = knownUsers();
if (known) {
  const removed = store.removeUnknownOwners(known);
  for (const { owner, contacts } of removed) {
    console.log(`Deleted ${contacts} contacts of ${owner}, who is no longer a Heimdall user`);
  }
  if (removed.length > 0) db.exec("VACUUM");
}

// Contacts in the recycle bin go for good after 30 days: checked now and once a day.
function purge() {
  const purged = store.purge();
  if (purged > 0) console.log(`Purged ${purged} contacts from the recycle bin`);
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
  // A page names the user whose contacts it shows. If someone else has signed in since (in
  // another tab), its changes must not land in their contacts: 409 makes it reload as the new user.
  const expected = req.get(USER_HEADER);
  if (expected !== undefined && expected !== auth.user(req).username) {
    return void res.status(409).json({ error: "Someone else is signed in now", code: "other-user" } satisfies ApiError);
  }
  next();
});
// Bodies are read only once the user is known. An import sends every contact at once; anything
// else is at most one contact (a 20,000-character memo and a few hundred short fields).
app.use("/api/import", express.json({ limit: "32mb" }));
app.use(express.json({ limit: "1mb" }));

const owner = (req: express.Request) => auth.user(req).username;

// The signed-in user
app.get("/api/me", auth.me);

app.get("/api/contacts", (req, res) => {
  res.json(store.list(owner(req), req.query));
});
app.post("/api/contacts", (req, res) => {
  res.status(201).json(store.create(owner(req), req.body));
});
app.get("/api/contacts/:id", (req, res) => {
  res.json(store.get(owner(req), req.params.id));
});
app.put("/api/contacts/:id", (req, res) => {
  res.json(store.put(owner(req), req.params.id, req.body));
});
app.patch("/api/contacts/:id", (req, res) => {
  res.json(store.patch(owner(req), req.params.id, req.body));
});
// To the recycle bin; with ?purge=1, out of it for good.
app.delete("/api/contacts/:id", (req, res) => {
  if (req.query.purge === "1") store.purgeContact(owner(req), req.params.id);
  else store.bin(owner(req), req.params.id);
  res.status(204).end();
});
app.post("/api/contacts/:id/restore", (req, res) => {
  res.json(store.restore(owner(req), req.params.id));
});

app.get("/api/groups", (req, res) => {
  res.json(store.groups(owner(req)));
});
app.post("/api/groups", (req, res) => {
  res.status(201).json(store.createGroup(owner(req), req.body));
});
app.patch("/api/groups/:id", (req, res) => {
  res.json(store.updateGroup(owner(req), req.params.id, req.body));
});
app.delete("/api/groups/:id", (req, res) => {
  store.deleteGroup(owner(req), req.params.id);
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
  res.attachment(`vinr-${file.exportedAt.slice(0, 10)}.json`).json(file);
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
    if (err.contact) body.contact = err.contact;
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
