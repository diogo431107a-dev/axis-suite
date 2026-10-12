import express, { type ErrorRequestHandler } from "express";
import { heimdallAuth } from "@axis-suite/heimdall-client/server";
import { USER_HEADER, type ApiError } from "../shared/protocol.ts";
import { DB_FILE, openDatabase } from "./db.ts";
import { loadKey } from "./keys.ts";
import { createSealer } from "./seal.ts";
import { VaultError, createVault } from "./vault.ts";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3003);

const db = openDatabase(DB_FILE);
console.log(`Vault database: ${DB_FILE}`);
// Refuses to start if the key is missing, or isn't the one the database was made with.
const vault = createVault(db, createSealer(loadKey()));

// Entries in the recycle bin go for good after 30 days: checked now and once a day.
function purge() {
  const purged = vault.purge();
  if (purged > 0) console.log(`Purged ${purged} entries from the recycle bin`);
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

// An import sends a whole vault at once.
app.use(express.json({ limit: "10mb" }));
app.use("/api", auth.sameOriginWrites, auth.requireUser, (req, res, next) => {
  res.set("Cache-Control", "no-store");
  // A page names the user whose vault it shows. If someone else has signed in since (in another
  // tab), its changes must not land in their vault: 409 makes it reload as the new user.
  const expected = req.get(USER_HEADER);
  if (expected !== undefined && expected !== auth.user(req).username) {
    return void res.status(409).json({ error: "Someone else is signed in now", code: "other-user" } satisfies ApiError);
  }
  next();
});

const owner = (req: express.Request) => auth.user(req).username;

// The signed-in user
app.get("/api/me", auth.me);

// Groups and entries without their secrets, as the page loads them
app.get("/api/vault", (req, res) => {
  res.json(vault.load(owner(req)));
});

app.post("/api/groups", (req, res) => {
  res.status(201).json(vault.createGroup(owner(req), req.body));
});
app.patch("/api/groups/:id", (req, res) => {
  res.json(vault.updateGroup(owner(req), req.params.id, req.body));
});
app.delete("/api/groups/:id", (req, res) => {
  vault.deleteGroup(owner(req), req.params.id);
  res.status(204).end();
});

app.post("/api/entries", (req, res) => {
  res.status(201).json(vault.createEntry(owner(req), req.body));
});
app.get("/api/entries/:id", (req, res) => {
  res.json(vault.getEntry(owner(req), req.params.id));
});
app.patch("/api/entries/:id", (req, res) => {
  res.json(vault.updateEntry(owner(req), req.params.id, req.body));
});
// To the recycle bin; with ?purge=1, out of it for good.
app.delete("/api/entries/:id", (req, res) => {
  if (req.query.purge === "1") {
    vault.purgeEntry(owner(req), req.params.id);
    return void res.status(204).end();
  }
  res.json(vault.deleteEntry(owner(req), req.params.id));
});
app.post("/api/entries/:id/restore", (req, res) => {
  res.json(vault.restoreEntry(owner(req), req.params.id));
});
app.get("/api/entries/:id/totp", async (req, res) => {
  res.json(await vault.totpCode(owner(req), req.params.id));
});
app.get("/api/entries/:id/totp/uri", (req, res) => {
  res.json({ uri: vault.totpUri(owner(req), req.params.id) });
});

app.get("/api/export", (req, res) => {
  const file = vault.exportAll(owner(req));
  res.attachment(`janus-${file.exportedAt.slice(0, 10)}.json`).json(file);
});
app.post("/api/import", (req, res) => {
  res.json(vault.importAll(owner(req), req.body));
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "No such API" } satisfies ApiError);
});

// Errors as JSON. VaultError is a refused request; express.json's own errors carry a status.
// Anything else is a bug: logged, and answered without details.
const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof VaultError) {
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

const server = app.listen(PORT, HOST, () => console.log(`Listening on http://${HOST}:${PORT}`));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
