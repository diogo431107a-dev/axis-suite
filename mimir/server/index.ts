import express, { type ErrorRequestHandler } from "express";
import { heimdallAuth, knownUsers } from "@axis-suite/heimdall-client/server";
import { USER_HEADER, type ApiError } from "../shared/protocol.ts";
import { DB_FILE, openDatabase } from "./db.ts";
import { StoreError } from "./errors.ts";
import { createMaps } from "./maps.ts";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3009);

const db = openDatabase(DB_FILE);
console.log(`Maps database: ${DB_FILE}`);
const maps = createMaps(db);

// The maps of users removed from Heimdall go for good at start-up; the installer restarts this
// service when Heimdall's list of users changes. VACUUM gives the space back to the disk.
const known = knownUsers();
if (known) {
  const removed = maps.removeUnknownOwners(known);
  for (const { owner, maps: n } of removed) {
    console.log(`Deleted the ${n} maps of ${owner}, who is no longer a Heimdall user`);
  }
  if (removed.length > 0) db.exec("VACUUM");
}

// Nodes and arrows deleted long ago (kept so undo works) go for good, at start-up and daily.
function purge() {
  const purged = maps.purge();
  if (purged > 0) console.log(`Purged old deleted nodes and arrows in ${purged} maps`);
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
  // A page names the user whose maps it shows. If someone else has signed in since (in another
  // tab), its changes must not land on their maps: 409 makes it reload as the new user.
  const expected = req.get(USER_HEADER);
  if (expected !== undefined && expected !== auth.user(req).username) {
    return void res.status(409).json({ error: "Someone else is signed in now", code: "other-user" } satisfies ApiError);
  }
  next();
});
// Bodies are read only once the user is known. A restore sends a whole file; a batch of ops at
// most 2,000 ops (the page keeps its batches under 3 million characters); anything else is small.
const restoreJson = express.json({ limit: "32mb" });
const opsJson = express.json({ limit: "5mb" });
const smallJson = express.json({ limit: "1mb" });
app.use("/api", (req, res, next) => {
  const parse = req.path === "/restore" ? restoreJson : req.path.endsWith("/ops") ? opsJson : smallJson;
  parse(req, res, next);
});

const owner = (req: express.Request) => auth.user(req).username;

// The signed-in user
app.get("/api/me", auth.me);

app.get("/api/maps", (req, res) => {
  res.json(maps.list(owner(req)));
});
app.post("/api/maps", (req, res) => {
  res.status(201).json(maps.create(owner(req), req.body));
});
app.get("/api/maps/:id", (req, res) => {
  res.json(maps.load(owner(req), req.params.id));
});
app.delete("/api/maps/:id", (req, res) => {
  maps.remove(owner(req), req.params.id);
  res.status(204).end();
});
app.post("/api/maps/:id/move", (req, res) => {
  res.json(maps.move(owner(req), req.params.id, req.body));
});
app.post("/api/maps/:id/ops", (req, res) => {
  res.json(maps.applyOps(owner(req), req.params.id, req.body));
});
app.get("/api/maps/:id/changes", (req, res) => {
  res.json(maps.changes(owner(req), req.params.id, req.query.since));
});
app.get("/api/maps/:id/export", (req, res) => {
  res.json(maps.exportMaps(owner(req), req.params.id));
});

app.get("/api/export", (req, res) => {
  const file = maps.exportMaps(owner(req));
  res.attachment(`mimir-${file.exportedAt.slice(0, 10)}.json`).json(file);
});
app.post("/api/restore", (req, res) => {
  res.json(maps.restore(owner(req), req.body));
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
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
