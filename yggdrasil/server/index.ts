import express from "express";
import { heimdallAuth, knownUsers } from "@axis-suite/heimdall-client/server";
import { LIMITS, USER_HEADER } from "../shared/protocol.ts";
import { DB_FILE, openDatabase } from "./db.ts";
import { createEvents } from "./events.ts";
import { AccessError, BatchError, createTree } from "./tree.ts";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3002);

const db = openDatabase(DB_FILE);
console.log(`Tree database: ${DB_FILE}`);
const tree = createTree(db);
const events = createEvents();

// The trees of users removed from Heimdall go for good at start-up; the installer restarts this
// service when Heimdall's list of users changes. VACUUM gives the space back to the disk.
const known = knownUsers();
if (known) {
  const removed = tree.removeUnknownOwners(known);
  for (const { owner, rows } of removed) {
    console.log(`Deleted ${rows} bullets of ${owner}, who is no longer a Heimdall user`);
  }
  if (removed.length > 0) db.exec("VACUUM");
}

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
app.use("/api", auth.sameOriginWrites, auth.requireUser, (req, res, next) => {
  res.set("Cache-Control", "no-store");
  // A page names the user whose tree it shows. If someone else has signed in since (in another
  // tab), its changes must not land in their tree: 409 makes it reload as the new user.
  const expected = req.get(USER_HEADER) ?? req.query.user;
  if (typeof expected === "string" && expected !== auth.user(req).username) {
    return void res.status(409).json({ error: "Someone else is signed in now" });
  }
  next();
});

// The signed-in user
app.get("/api/me", auth.me);

// The users the signed-in user can share bullets with: every Heimdall user but themselves.
app.get("/api/users", (req, res) => {
  const { username } = auth.user(req);
  res.json([...(known ?? [])].filter((u) => u !== username).sort());
});

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
    const notify = new Set<string>();
    const result = tree.applyOps(username, ops, notify);
    // The user's other tabs, and whoever else sees the bullets changed.
    if (result.rev !== null) for (const u of notify) events.publish(u, { rev: result.rev, clientId });
    res.json(result);
  } catch (err) {
    if (err instanceof BatchError) return void res.status(400).json({ error: err.message });
    throw err;
  }
});

/** Answers a refused sharing request, or hands anything else on to Express. */
function sharing(res: express.Response, fn: (notify: Set<string>) => void) {
  const notify = new Set<string>();
  try {
    fn(notify);
  } catch (err) {
    if (err instanceof AccessError) return void res.status(err.status).json({ error: err.message });
    throw err;
  }
  for (const u of notify) events.publish(u, { rev: tree.currentRev(), clientId: "" });
}

// Who a bullet of the user's own is shared with
app.get("/api/nodes/:id/shares", (req, res) => {
  sharing(res, () => res.json(tree.shares(auth.user(req).username, req.params.id)));
});

// Share: replace everyone the bullet (and everything under it) is shared with
app.put("/api/nodes/:id/shares", (req, res) => {
  sharing(res, (notify) => res.json(tree.setShares(auth.user(req).username, req.params.id, req.body, known, notify)));
});

// Stop sharing with one person. The owner can remove anyone; anyone can remove themselves.
app.delete("/api/nodes/:id/shares/:username", (req, res) => {
  sharing(res, (notify) => {
    tree.removeShare(auth.user(req).username, req.params.id, req.params.username, notify);
    res.status(204).end();
  });
});

// Live updates: a "rev" event each time the user's tree, or a bullet shared with them, changes
app.get("/api/events", (req, res) => {
  events.subscribe(auth.user(req).username, req, res);
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
  process.on(signal, () => {
    // Event streams never end on their own, so they are closed first.
    events.closeAll();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
