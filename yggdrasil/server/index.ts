import { randomUUID } from "node:crypto";
import express from "express";
import { heimdallAuth, knownUsers } from "@axis-suite/heimdall-client/server";
import { IMAGE_TYPES, LIMITS, USER_HEADER, isUuid, type UploadedFile } from "../shared/protocol.ts";
import { DB_FILE, openDatabase } from "./db.ts";
import { createEvents } from "./events.ts";
import { FILES_DIR, TooLargeError, createFiles } from "./files.ts";
import { AccessError, BatchError, createTree } from "./tree.ts";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3002);

const db = openDatabase(DB_FILE);
console.log(`Tree database: ${DB_FILE}`);
const tree = createTree(db);
const files = createFiles(FILES_DIR);
const events = createEvents();

// An upload is refused if it would leave less than this free on the disk, which other services
// (mail, say) share.
const MIN_FREE_BYTES = Number(process.env.YGGDRASIL_MIN_FREE_MB ?? 2048) * 1024 * 1024;

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

// Deleted bullets go for good after 30 days, and so do files no bullet has referred to for as
// long: checked now and once a day.
function purge() {
  const purged = tree.purge();
  if (purged > 0) console.log(`Purged ${purged} deleted bullets (and everything under them)`);
  const unused = tree.purgeFiles();
  for (const id of unused) files.remove(id);
  if (unused.length > 0) console.log(`Purged ${unused.length} files no bullet refers to any more`);
}
purge();
setInterval(purge, 24 * 60 * 60_000).unref();

// Files on disk the database doesn't know: uploads cut off by a restart, removed users' files.
const swept = files.sweep(tree.fileIds());
if (swept > 0) console.log(`Deleted ${swept} files on disk that no longer belong to anyone`);

const auth = heimdallAuth();
const app = express();
app.disable("x-powered-by");

// Liveness check for the installer and monitoring. Every module answers it.
app.get("/healthz", (_req, res) => {
  res.type("text/plain").set("Cache-Control", "no-store").send("ok");
});

// ── Uploads ─────────────────────────────────────────────────────────────────────────────────
// A file is sent as it is (application/octet-stream), not as JSON, so these two routes come
// before sameOriginWrites and check the same things themselves. They also require the page's
// X-Yggdrasil-User header: a page on another site can't send a header like that without asking
// first (a CORS preflight), and nothing here ever says yes.

/**
 * Answers before the body has been read. The connection is closed afterwards, rather than
 * reading (and throwing away) up to 200 MB the browser is still sending.
 */
function refuse(res: express.Response, status: number, error: string) {
  res.set("Connection", "close").status(status).json({ error });
}

const uploadGuard: express.RequestHandler = (req, res, next) => {
  const origin = req.get("origin");
  if (origin) {
    let host: string | undefined;
    try {
      host = new URL(origin).host;
    } catch {
      // malformed: treat as foreign
    }
    if (host !== req.get("host")) return void refuse(res, 403, "Cross-origin request refused");
  }
  const expected = req.get(USER_HEADER);
  if (!expected) return void refuse(res, 403, `${USER_HEADER} is required`);
  if (expected !== auth.user(req).username) return void refuse(res, 409, "Someone else is signed in now");
  if (req.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/octet-stream")
    return void refuse(res, 415, "Expected application/octet-stream");
  res.set("Cache-Control", "no-store");
  next();
};

/** The length the request announces, if it is within `limit`; otherwise answers and returns null. */
function bodyLength(req: express.Request, res: express.Response, limit: number): number | null {
  const header = req.get("content-length");
  const length = Number(header);
  if (!header || !Number.isSafeInteger(length) || length < 0) {
    refuse(res, 411, "Content-Length is required");
    return null;
  }
  if (length > limit) {
    refuse(res, 413, `Files can be at most ${Math.round(limit / 1024 / 1024)} MB`);
    return null;
  }
  return length;
}

/** A file name as given, made safe to show and to send back in a header. */
function cleanName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  // oxlint-disable-next-line no-control-regex
  const clean = name.replace(/[\u0000-\u001f\u007f/\\]/g, "_").trim();
  return clean && clean.length <= LIMITS.fileNameChars ? clean : null;
}

/** Whether an upload failed because the browser stopped sending (the tab was closed, say). */
const cutOff = (req: express.Request, err: unknown) =>
  req.destroyed || (err as NodeJS.ErrnoException).code === "ERR_STREAM_PREMATURE_CLOSE";

// Upload a file into a bullet the user may change: POST /api/files?node=<id>&name=<file name>
app.post("/api/files", auth.requireUser, uploadGuard, async (req, res) => {
  const { username } = auth.user(req);
  const node = req.query.node;
  const name = cleanName(req.query.name);
  if (!isUuid(node)) return void refuse(res, 400, "node must be a bullet's id");
  if (!name) return void refuse(res, 400, `name must be 1 to ${LIMITS.fileNameChars} characters`);
  const length = bodyLength(req, res, LIMITS.fileBytes);
  if (length === null) return;
  if (files.freeBytes() - length < MIN_FREE_BYTES) {
    return void refuse(res, 507, "The server is running out of disk space, so it takes no more files");
  }
  let owner: string;
  try {
    owner = tree.uploadOwner(username, node);
  } catch (err) {
    if (err instanceof AccessError) return void refuse(res, err.status, err.message);
    throw err;
  }
  const id = randomUUID();
  try {
    const { size, type } = await files.save(req, id, LIMITS.fileBytes);
    tree.addFile({ id, owner, uploader: username, name, type, size });
    res.status(201).json({ id, name, type, size } satisfies UploadedFile);
  } catch (err) {
    files.remove(id);
    if (err instanceof TooLargeError) return void refuse(res, 413, "The file is larger than it said");
    if (cutOff(req, err)) return; // nobody is left to answer
    throw err;
  }
});

// An image's preview, made by the browser that uploaded it: PUT /api/files/<id>/preview
app.put("/api/files/:id/preview", auth.requireUser, uploadGuard, async (req, res) => {
  const id = String(req.params.id).toLowerCase();
  if (!isUuid(id)) return void refuse(res, 404, "No such file");
  try {
    tree.previewTarget(auth.user(req).username, id);
  } catch (err) {
    if (err instanceof AccessError) return void refuse(res, err.status, err.message);
    throw err;
  }
  if (bodyLength(req, res, LIMITS.previewBytes) === null) return;
  try {
    const { type } = await files.save(req, id, LIMITS.previewBytes, true);
    if (type !== "image/webp" && type !== "image/jpeg") {
      files.removePreview(id);
      return void refuse(res, 415, "A preview must be a WebP or JPEG image");
    }
    tree.setPreview(id);
    res.status(204).end();
  } catch (err) {
    files.removePreview(id);
    if (err instanceof TooLargeError) return void refuse(res, 413, "The preview is larger than it said");
    if (cutOff(req, err)) return;
    throw err;
  }
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

/** A file name for Content-Disposition (RFC 5987). */
const headerName = (name: string) =>
  encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// A file (or an image's preview): to its owner, its uploader, and whoever sees a bullet that
// refers to it. Others get 404, as for a file that doesn't exist.
function sendFile(req: express.Request, res: express.Response, wantPreview: boolean) {
  const id = String(req.params.id).toLowerCase();
  const file = isUuid(id) ? tree.fileFor(auth.user(req).username, id) : null;
  if (!file) return void res.status(404).json({ error: "No such file" });
  const preview = wantPreview && file.has_preview === 1;
  const type = preview ? files.typeOf(files.path(id, true)) : file.type;
  // Only images are shown in the page; anything else (HTML and SVG included) is downloaded, so no
  // uploaded file ever runs as a page of Yggdrasil's. The sandbox stops scripts even so.
  const disposition = IMAGE_TYPES.has(type) ? "inline" : "attachment";
  res.sendFile(
    files.path(id, preview),
    {
      cacheControl: false,
      headers: {
        "Content-Type": type,
        "Content-Disposition": `${disposition}; filename*=UTF-8''${headerName(file.name)}`,
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
        // A file never changes: a new upload is a new id.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    },
    (err) => {
      // Its bytes are gone (deleted by hand, say), or the download was cut off.
      if (err && !res.headersSent) res.status(404).json({ error: "No such file" });
    },
  );
}

app.get("/api/files/:id", (req, res) => sendFile(req, res, false));
app.get("/api/files/:id/preview", (req, res) => sendFile(req, res, true));

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
// Node gives up on a request after 5 minutes; a 200 MB upload over a slow line takes longer.
server.requestTimeout = 60 * 60_000;

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
