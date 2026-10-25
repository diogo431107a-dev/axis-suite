import express, { type NextFunction, type Request, type Response } from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { AccountError, SESSION_MAX_MS, createAccounts, type Player } from "./accounts.ts";
import { STATE_DIR, openDatabase } from "./db.ts";
import { createSaves, parseState, parseSummary } from "./saves.ts";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3011);
// The service unit sets NODE_ENV=production, where Saga is always served over HTTPS.
const SECURE = process.env.NODE_ENV === "production";
// "__Host-" makes browsers keep the cookie to this exact host: a sibling subdomain can't set or
// replace it. It needs HTTPS, so development uses a plain name.
const COOKIE = SECURE ? "__Host-saga" : "saga_sid";

const db = openDatabase();
const accounts = createAccounts(db);
const saves = createSaves(db);

const ended = accounts.dropEndedSessions();
if (ended > 0) console.log(`Dropped ${ended} ended sessions`);
setInterval(() => accounts.dropEndedSessions(), 6 * 60 * 60_000).unref();

// The owner's command line (server/admin.ts) proves itself with this token, made new on every
// start. Only root and this service can read the file.
const ADMIN_TOKEN = randomBytes(32).toString("hex");
writeFileSync(join(STATE_DIR, "admin.token"), ADMIN_TOKEN + "\n", { mode: 0o600 });

const app = express();
app.disable("x-powered-by");

// Liveness check for the installer and monitoring. Every module answers it.
app.get("/healthz", (_req, res) => {
  res.type("text/plain").set("Cache-Control", "no-store").send("ok");
});

// A whole game is a few tens of kilobytes; this leaves room to grow.
app.use(express.json({ limit: "512kb" }));

// ---- Cookies and the client --------------------------------------------------------------------

function readCookie(req: Request): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

function setSessionCookie(res: Response, token: string, maxAgeMs: number) {
  res.append(
    "Set-Cookie",
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${SECURE ? "; Secure" : ""}`,
  );
}

const isLoopback = (addr: string | undefined) => addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";

// Caddy appends the address it saw to X-Forwarded-For, so its last entry is the real client.
function clientIp(req: Request): string {
  const remote = req.socket.remoteAddress ?? "unknown";
  if (!isLoopback(remote)) return remote;
  const header = req.headers["x-forwarded-for"];
  return (Array.isArray(header) ? header.join(",") : header)?.split(",").pop()?.trim() || remote;
}

// ---- Failed sign-ins and invite codes, by client address ---------------------------------------

const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60_000;
const failures = new Map<string, { count: number; last: number; lockedUntil: number }>();
// Clients with a check in progress: parallel guesses can't slip past the limit.
const inFlight = new Set<string>();

function lockedFor(ip: string): number {
  const f = failures.get(ip);
  return f ? Math.max(0, f.lockedUntil - Date.now()) : 0;
}

function recordFailure(ip: string) {
  const t = Date.now();
  let f = failures.get(ip);
  // A streak of failures is forgotten after a quiet period as long as the lockout.
  if (!f || t - f.last > LOCKOUT_MS) failures.set(ip, (f = { count: 0, last: t, lockedUntil: 0 }));
  f.count++;
  f.last = t;
  if (f.count >= MAX_FAILURES) f.lockedUntil = t + LOCKOUT_MS;
}

setInterval(() => {
  const t = Date.now();
  for (const [ip, f] of failures) if (f.lockedUntil <= t && t - f.last > LOCKOUT_MS) failures.delete(ip);
}, LOCKOUT_MS).unref();

/** Runs a sign-in or sign-up for one client at a time, refusing it while the client is locked out. */
// attempt() says whether it succeeded, failed (counts towards the lockout) or neither (null).
async function guarded(req: Request, res: Response, attempt: () => Promise<boolean | null>) {
  const ip = clientIp(req);
  const locked = lockedFor(ip);
  if (locked > 0) {
    const minutes = Math.ceil(locked / 60_000);
    return void res.status(429).json({ error: `Too many failed attempts. Try again in ${minutes} min.` });
  }
  if (inFlight.has(ip))
    return void res.status(429).json({ error: "One moment: the last attempt is still being checked." });
  inFlight.add(ip);
  try {
    const outcome = await attempt();
    if (outcome) failures.delete(ip);
    else if (outcome === false) recordFailure(ip);
  } finally {
    inFlight.delete(ip);
  }
}

// ---- The API -----------------------------------------------------------------------------------

// Writes must come from Saga's own pages, as JSON: a form or script on another site can't post here.
function sameOriginWrites(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD") return next();
  const origin = req.headers.origin;
  if (origin) {
    let host: string | undefined;
    try {
      host = new URL(origin).host;
    } catch {
      // malformed: treat as foreign
    }
    if (host !== req.headers.host) return void res.status(403).json({ error: "Cross-origin request refused" });
  }
  if (req.method !== "DELETE" && !req.is("application/json")) {
    return void res.status(415).json({ error: "Expected application/json" });
  }
  next();
}

const players = new WeakMap<Request, Player>();

function optionalPlayer(req: Request, _res: Response, next: NextFunction) {
  const player = accounts.sessionPlayer(readCookie(req));
  if (player) players.set(req, player);
  next();
}

function requirePlayer(req: Request, res: Response, next: NextFunction) {
  if (!players.has(req)) return void res.status(401).json({ error: "Not signed in" });
  next();
}

const player = (req: Request) => players.get(req)!;
const me = (p: Player) => ({
  username: p.username,
  heroName: p.heroName,
  avatar: p.avatar,
  mustChangePassword: p.mustChangePassword,
});

/** Answers an AccountError with its status and message; anything else is a real failure. */
function fail(res: Response, err: unknown) {
  if (err instanceof AccountError) return void res.status(err.status).json({ error: err.message });
  throw err;
}

app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use("/api", sameOriginWrites, optionalPlayer);

app.post("/api/signup", (req, res) =>
  guarded(req, res, async () => {
    try {
      const p = await accounts.signUp(req.body ?? {});
      setSessionCookie(res, accounts.createSession(p.id), SESSION_MAX_MS);
      console.log(`${p.username} joined as ${p.heroName}`);
      res.status(201).json(me(p));
      return true;
    } catch (err) {
      fail(res, err);
      // Only a wrong invite code counts as a failed attempt; a taken name is an honest mistake.
      return err instanceof AccountError && err.status === 403 ? false : null;
    }
  }),
);

app.post("/api/login", (req, res) =>
  guarded(req, res, async () => {
    const { username, password } = (req.body ?? {}) as { username?: unknown; password?: unknown };
    const p = await accounts.signIn(username, password);
    if (!p) {
      res.status(401).json({ error: "Wrong username or password." });
      return false;
    }
    accounts.endSession(readCookie(req)); // never keep a session from before signing in
    setSessionCookie(res, accounts.createSession(p.id), SESSION_MAX_MS);
    res.json(me(p));
    return true;
  }),
);

app.post("/api/logout", (req, res) => {
  accounts.endSession(readCookie(req));
  setSessionCookie(res, "", 0);
  res.status(204).end();
});

// The public ranking. A signed-in player also gets their own row.
app.get("/api/ranking", (req, res) => {
  const by = req.query.by === "level" ? "level" : "fame";
  res.json(saves.ranking(by, players.get(req)?.id));
});

app.use("/api", requirePlayer);

app.get("/api/me", (req, res) => {
  res.json(me(player(req)));
});

app.put("/api/password", async (req, res) => {
  const { current, next } = (req.body ?? {}) as { current?: unknown; next?: unknown };
  try {
    await accounts.changePassword(player(req).id, current, next, readCookie(req));
    res.status(204).end();
  } catch (err) {
    fail(res, err);
  }
});

app.put("/api/hero", (req, res) => {
  const { heroName, avatar } = (req.body ?? {}) as { heroName?: unknown; avatar?: unknown };
  try {
    res.json(me(accounts.setHero(player(req).id, heroName, avatar)));
  } catch (err) {
    fail(res, err);
  }
});

app.delete("/api/account", async (req, res) => {
  const { password } = (req.body ?? {}) as { password?: unknown };
  try {
    const p = player(req);
    await accounts.deleteAccount(p.id, password);
    console.log(`${p.username} deleted their account`);
    setSessionCookie(res, "", 0);
    res.status(204).end();
  } catch (err) {
    fail(res, err);
  }
});

// The saved game, with the hero's name and look as they are now (they are kept with the account).
app.get("/api/save", (req, res) => {
  const p = player(req);
  const found = saves.load(p.id);
  if (!found) return void res.status(404).json({ error: "No saved game yet" });
  res.json(withHero(found, p));
});

function withHero(save: { revision: number; state: Record<string, unknown> }, p: Player) {
  const hero = (save.state.hero ?? {}) as Record<string, unknown>;
  return { revision: save.revision, state: { ...save.state, hero: { ...hero, name: p.heroName, avatar: p.avatar } } };
}

app.put("/api/save", (req, res) => {
  const { baseRevision, state, summary } = (req.body ?? {}) as {
    baseRevision?: unknown;
    state?: unknown;
    summary?: unknown;
  };
  const game = parseState(state);
  const numbers = parseSummary(summary);
  if (typeof baseRevision !== "number" || !Number.isInteger(baseRevision) || baseRevision < 0 || !game || !numbers) {
    return void res.status(400).json({ error: "Expected { baseRevision, state, summary }" });
  }
  const p = player(req);
  const result = saves.save(p.id, baseRevision, game, numbers);
  if (result.ok) return void res.json({ revision: result.revision });
  res.status(409).json({ error: "This game was saved from somewhere else", ...withHero(result.current, p) });
});

// Starting over: the saved game goes, the account stays.
app.delete("/api/save", (req, res) => {
  saves.clear(player(req).id);
  res.status(204).end();
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ---- The owner's commands ----------------------------------------------------------------------

// Only for server/admin.ts on this machine. Caddy forwards only /api, and the token proves the
// caller could read the token file, which takes root.
function adminOnly(req: Request, res: Response, next: NextFunction) {
  const given = Buffer.from((req.headers.authorization ?? "").replace(/^Bearer /, ""));
  const expected = Buffer.from(ADMIN_TOKEN);
  const ok =
    isLoopback(req.socket.remoteAddress) &&
    !req.headers["x-forwarded-for"] &&
    given.length === expected.length &&
    timingSafeEqual(given, expected);
  if (!ok) return void res.status(403).json({ error: "Forbidden" });
  next();
}

app.use("/admin", adminOnly);

app.post("/admin/invite", (req, res) => {
  const { note } = (req.body ?? {}) as { note?: unknown };
  res.json(accounts.createInvite(typeof note === "string" ? note : ""));
});
app.get("/admin/invites", (_req, res) => {
  res.json(accounts.listInvites());
});
app.get("/admin/players", (_req, res) => {
  res.json(accounts.listPlayers());
});
app.post("/admin/reset-password", async (req, res) => {
  try {
    const { username } = req.body as { username: string };
    res.json({ password: await accounts.resetPassword(String(username)) });
  } catch (err) {
    fail(res, err);
  }
});
app.post("/admin/rename-hero", (req, res) => {
  try {
    const { username, name } = req.body as { username: string; name: string };
    res.json(me(accounts.renameHero(String(username), name)));
  } catch (err) {
    fail(res, err);
  }
});
app.post("/admin/remove", (req, res) => {
  try {
    const { username } = req.body as { username: string };
    accounts.removePlayer(String(username));
    console.log(`The owner removed ${username}`);
    res.status(204).end();
  } catch (err) {
    fail(res, err);
  }
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
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
}
