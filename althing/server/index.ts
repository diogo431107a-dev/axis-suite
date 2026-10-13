import express, { type ErrorRequestHandler, type Request } from "express";
import { heimdallAuth, knownUsers } from "@axis-suite/heimdall-client/server";
import { LIMITS, USER_HEADER, type ApiError, type ChatState } from "../shared/protocol.ts";
import { DB_FILE, openDatabase } from "./db.ts";
import { createEvents } from "./events.ts";
import { createOnline } from "./online.ts";
import { createPresence } from "./presence.ts";
import { StoreError, createStore } from "./store.ts";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3008);

const db = openDatabase(DB_FILE);
console.log(`Chat database: ${DB_FILE}`);
const store = createStore(db);

// Users removed from Heimdall are forgotten at start-up (the installer restarts this service when
// Heimdall's list of users changes). What they wrote stays, as a "deleted user": messages belong
// to the conversation. Everyone else gets a profile, so they can be found and written to.
const known = knownUsers();
if (known) {
  for (const { username, messages } of store.removeUnknownOwners(known)) {
    console.log(`Forgot ${username}, who is no longer a Heimdall user; their ${messages} messages stay, unsigned`);
  }
  for (const username of known) store.ensureProfile(username);
}
const fixed = store.fixAvatars();
if (fixed > 0) console.log(`Gave a new picture to ${fixed} profile(s) whose picture is no longer in the set`);

const auth = heimdallAuth();
const events = createEvents({
  onConnect: (username) => {
    presence.connected(username);
    void online.refresh();
  },
  onDisconnect: (username) => presence.disconnected(username),
});
const presence = createPresence(store, {
  isConnected: events.isConnected,
  onRoomsChanged: () => events.send("everyone", "rooms", store.rooms()),
});
presence.start();
const online = createOnline({
  internalUrl: process.env.HEIMDALL_INTERNAL_URL ?? "http://127.0.0.1:3000",
  events,
  onChange: (usernames) => {
    // Someone Althing hasn't heard of yet (no AXIS_USERS in development) gets a profile too.
    for (const username of usernames) {
      const { person, created } = store.ensureProfile(username);
      if (created) events.send("everyone", "person", person);
    }
    events.send("everyone", "online", usernames);
  },
});

const app = express();
app.disable("x-powered-by");

// Liveness check for the installer and monitoring. Every module answers it.
app.get("/healthz", (_req, res) => {
  res.type("text/plain").set("Cache-Control", "no-store").send("ok");
});

app.use("/api", auth.sameOriginWrites, auth.requireUser, (req, res, next) => {
  res.set("Cache-Control", "no-store");
  // A page names the user it belongs to. If someone else has signed in since (in another tab), it
  // must not write as them: 409 makes it reload as the new user. EventSource can't send headers,
  // so the event stream names its user in ?user=.
  const expected = req.get(USER_HEADER) ?? req.query.user;
  if (typeof expected === "string" && expected !== auth.user(req).username) {
    return void res.status(409).json({ error: "Someone else is signed in now", code: "other-user" } satisfies ApiError);
  }
  next();
});
// Bodies are read only once the user is known; the largest is one message.
app.use(express.json({ limit: "64kb" }));

const me = (req: Request) => auth.user(req).username;

function roomId(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new StoreError(404, "There is no such room");
  return id;
}

// When each person last sent messages, for the rate limit.
const recent = new Map<string, number[]>();
function tooFast(username: string): boolean {
  const now = Date.now();
  const times = (recent.get(username) ?? []).filter((t) => now - t < LIMITS.burstMs);
  if (times.length >= LIMITS.burst) return true;
  times.push(now);
  recent.set(username, times);
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [username, times] of recent) if (times.every((t) => now - t >= LIMITS.burstMs)) recent.delete(username);
}, 60_000).unref();

// The signed-in user
app.get("/api/me", auth.me);

// Everything the page shows at the start, and again after its live connection was lost.
app.get("/api/state", (req, res) => {
  const username = me(req);
  const { person, created } = store.ensureProfile(username);
  if (created) events.send("everyone", "person", person);
  const current = online.current();
  const state: ChatState = {
    me: person,
    welcomed: store.welcomed(username),
    people: store.people(),
    online: current.includes(username) ? current : [...current, username].sort(),
    rooms: store.rooms(),
    dms: store.dms(username),
    unread: store.unread(username),
  };
  res.json(state);
});

app.put("/api/profile", (req, res) => {
  const person = store.updateProfile(me(req), req.body);
  events.send("everyone", "person", person);
  res.json(person);
});
app.post("/api/welcomed", (req, res) => {
  store.setWelcomed(me(req));
  res.status(204).end();
});

app.post("/api/rooms", (req, res) => {
  res.status(201).json({ id: presence.create(me(req), req.body) });
});
app.post("/api/rooms/:id/join", (req, res) => {
  presence.join(me(req), roomId(req));
  res.status(204).end();
});
app.post("/api/rooms/:id/leave", (req, res) => {
  presence.leave(me(req), roomId(req));
  res.status(204).end();
});

// A direct conversation with someone, started if it is new.
app.post("/api/dms", (req, res) => {
  res.json(store.openDm(me(req), (req.body as { with?: unknown } | undefined)?.with));
});

app.get("/api/messages/:conv", (req, res) => {
  const before = typeof req.query.before === "string" ? Number(req.query.before) : undefined;
  res.json(store.history(me(req), req.params.conv, before));
});
app.post("/api/messages/:conv", (req, res) => {
  const username = me(req);
  if (tooFast(username)) {
    return void res.status(429).json({ error: "Slow down a little", code: "too-fast" } satisfies ApiError);
  }
  const message = store.post(username, req.params.conv, req.body);
  events.send(store.audience(message.conv), "message", message);
  res.status(201).json(message);
});

app.post("/api/read", (req, res) => {
  const { conv, id } = (req.body ?? {}) as { conv?: unknown; id?: unknown };
  store.markRead(me(req), typeof conv === "string" ? conv : "", id);
  res.status(204).end();
});

// Live updates: messages, rooms, who is online, and profiles
app.get("/api/events", (req, res) => {
  events.subscribe(me(req), req, res);
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "No such API" } satisfies ApiError);
});

// Errors as JSON. StoreError is a refused request; express.json's own errors carry a status.
// Anything else is a bug: logged, and answered without details.
const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof StoreError) return void res.status(err.status).json({ error: err.message } satisfies ApiError);
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
    // Event streams never end on their own, so they are closed first. Rooms keep their people:
    // after the restart they have the grace period to reconnect.
    presence.stop();
    online.stop();
    events.closeAll();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
