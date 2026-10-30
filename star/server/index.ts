import express, { type ErrorRequestHandler } from "express";
import { heimdallAuth, knownUsers } from "@axis-suite/heimdall-client/server";
import { USER_HEADER, type ApiError } from "../shared/protocol.ts";
import { DB_FILE, openDatabase } from "./db.ts";
import { StoreError } from "./errors.ts";
import { createSky } from "./sky.ts";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3012);

const db = openDatabase(DB_FILE);
console.log(`Sky database: ${DB_FILE}`);
const sky = createSky(db);

// The skies of users removed from Heimdall go for good at start-up; the installer restarts this
// service when Heimdall's list of users changes. VACUUM gives the space back to the disk.
const known = knownUsers();
if (known) {
  const removed = sky.removeUnknownOwners(known);
  for (const { owner, stars } of removed) {
    console.log(`Deleted the ${stars} stars of ${owner}, who is no longer a Heimdall user`);
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
  // A page names the user whose sky it shows. If someone else has signed in since (in another
  // tab), its changes must not land on their sky: 409 makes it reload as the new user.
  const expected = req.get(USER_HEADER);
  if (expected !== undefined && expected !== auth.user(req).username) {
    return void res.status(409).json({ error: "Someone else is signed in now", code: "other-user" } satisfies ApiError);
  }
  next();
});
// Bodies are read only once the user is known.
app.use("/api", express.json({ limit: "2mb" }));

const owner = (req: express.Request) => auth.user(req).username;

// The signed-in user
app.get("/api/me", auth.me);

app.get("/api/sky", (req, res) => {
  res.json(sky.load(owner(req)));
});
app.post("/api/sky/ops", (req, res) => {
  res.json(sky.applyOps(owner(req), req.body));
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
