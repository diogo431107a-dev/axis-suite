import express from "express";
import { heimdallAuth } from "@axis-suite/heimdall-client/server";
import { LIMITS } from "../shared/protocol.ts";
import { DB_FILE, openDatabase } from "./db.ts";
import { createEvents } from "./events.ts";
import { BatchError, createTree } from "./tree.ts";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3002);

const db = openDatabase(DB_FILE);
console.log(`Tree database: ${DB_FILE}`);
const tree = createTree(db);
const events = createEvents();

// Deleted bullets go for good after 30 days: checked now and once a day.
function purge() {
  const purged = tree.purge();
  if (purged > 0) console.log(`Purged ${purged} deleted bullets (and everything under them)`);
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

// An OPML import sends a few thousand bullets at once.
app.use(express.json({ limit: "10mb" }));
app.use("/api", auth.sameOriginWrites, auth.requireUser, (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// The signed-in user
app.get("/api/me", auth.me);

// The whole tree, as the page loads it
app.get("/api/tree", (req, res) => {
  res.json(tree.load(auth.user(req).username));
});

// What changed after a revision the page already has
app.get("/api/changes", (req, res) => {
  const since = Number(req.query.since);
  if (!Number.isSafeInteger(since) || since < 0)
    return void res.status(400).json({ error: "since must be a revision" });
  res.json(tree.changesSince(auth.user(req).username, since));
});

// A batch of changes, saved as one revision and announced to the user's other tabs
app.post("/api/ops", (req, res) => {
  const { clientId, ops } = (req.body ?? {}) as { clientId?: unknown; ops?: unknown };
  if (typeof clientId !== "string" || !clientId || clientId.length > LIMITS.clientIdChars) {
    return void res.status(400).json({ error: "clientId must be a short string" });
  }
  const { username } = auth.user(req);
  try {
    const result = tree.applyOps(username, ops);
    if (result.rev !== null) events.publish(username, { rev: result.rev, clientId });
    res.json(result);
  } catch (err) {
    if (err instanceof BatchError) return void res.status(400).json({ error: err.message });
    throw err;
  }
});

// Live updates: a "rev" event each time the user's tree changes
app.get("/api/events", (req, res) => {
  events.subscribe(auth.user(req).username, req, res);
});

const server = app.listen(PORT, HOST, () => console.log(`Listening on http://${HOST}:${PORT}`));

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
