import express, { type ErrorRequestHandler, type Request, type Response } from "express";
import { heimdallAuth, knownUsers } from "@axis-suite/heimdall-client/server";
import { randomUUID } from "node:crypto";
import { LIMITS, type ApiError, type Turn } from "../shared/protocol.ts";
import { frame } from "../shared/sse.ts";
import { asStoreError, contextWindow, countTokens, hasApiKey, keySource, streamReply } from "./claude.ts";
import { id as checkId, object, required } from "./check.ts";
import { StoreError } from "./errors.ts";
import { createConversations } from "./log.ts";
import { buildSystem, promptView } from "./prompt.ts";
import { createBusy } from "./busy.ts";
import { createStore } from "./store.ts";
import { STATE_DIR, removeUnknownOwners, rootOf } from "./users.ts";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3015);

console.log(`Everyone's characters, personas and conversations: ${STATE_DIR}/users`);
console.log(`Claude API key: ${keySource()}`);

// Someone removed from Heimdall leaves nothing behind. Without the list (development, or Heimdall
// not installed yet) nothing is deleted.
const known = knownUsers();
if (known) {
  for (const name of await removeUnknownOwners(known)) {
    console.log(`Deleted the folder of ${name}, who is no longer in Heimdall`);
  }
}

const auth = heimdallAuth();

/** The signed-in person's own store and conversations. Made per request: they hold no state. */
function ownedBy(req: Request) {
  const { username } = auth.user(req);
  const root = rootOf(username);
  const store = createStore(root);
  return { username, store, conversations: createConversations(store, root) };
}

const busy = createBusy();

// While Claude thinks, nothing is written for a while. A comment line now and then keeps every
// proxy in between from deciding the stream has gone quiet for good.
const HEARTBEAT_MS = 20_000;

const app = express();
app.disable("x-powered-by");

// Liveness check, for whatever starts this.
app.get("/healthz", (_req, res) => {
  res.type("text/plain").set("Cache-Control", "no-store").send("ok");
});

// Every API call is someone signed in to Heimdall, writing from Valhalla's own page.
app.use("/api", auth.sameOriginWrites, auth.requireUser, (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
// A definition can be long: three 20,000-character fields plus settings.
app.use("/api", express.json({ limit: "1mb" }));

app.get("/api/me", auth.me);

app.get("/api/health", (_req, res) => {
  res.json({ apiKey: hasApiKey() });
});

// Characters
app.get("/api/characters", async (req: Request, res: Response) => {
  const my = ownedBy(req);
  res.json(await my.store.characters());
});
app.put("/api/characters/:id", async (req: Request, res: Response) => {
  const my = ownedBy(req);
  res.json(await my.store.saveCharacter(checkId(req.params.id), req.body));
});
app.delete("/api/characters/:id", async (req: Request, res: Response) => {
  const my = ownedBy(req);
  const id = checkId(req.params.id);
  await my.conversations.refuseIfUsed("character", id);
  await my.store.removeCharacter(id);
  res.status(204).end();
});

// Personas
app.get("/api/personas", async (req: Request, res: Response) => {
  const my = ownedBy(req);
  res.json(await my.store.personas());
});
app.put("/api/personas/:id", async (req: Request, res: Response) => {
  const my = ownedBy(req);
  res.json(await my.store.savePersona(checkId(req.params.id), req.body));
});
app.delete("/api/personas/:id", async (req: Request, res: Response) => {
  const my = ownedBy(req);
  const id = checkId(req.params.id);
  await my.conversations.refuseIfUsed("persona", id);
  await my.store.removePersona(id);
  res.status(204).end();
});

// Conversations
app.get("/api/conversations", async (req: Request, res: Response) => {
  const my = ownedBy(req);
  res.json(await my.conversations.list());
});
app.post("/api/conversations", async (req: Request, res: Response) => {
  const my = ownedBy(req);
  res.status(201).json(await my.conversations.create(req.body));
});
app.get("/api/conversations/:id", async (req: Request, res: Response) => {
  const my = ownedBy(req);
  res.json(await my.conversations.page(checkId(req.params.id)));
});
app.patch("/api/conversations/:id/settings", async (req: Request, res: Response) => {
  const my = ownedBy(req);
  res.json(await my.conversations.changeSettings(checkId(req.params.id), req.body));
});
app.patch("/api/conversations/:id", async (req: Request, res: Response) => {
  const my = ownedBy(req);
  res.json(await my.conversations.rename(checkId(req.params.id), req.body));
});
app.delete("/api/conversations/:id", async (req: Request, res: Response) => {
  const my = ownedBy(req);
  await my.conversations.remove(checkId(req.params.id));
  res.status(204).end();
});

// The request exactly as it will be sent. Nothing is assembled out of sight.
app.get("/api/conversations/:id/prompt", async (req: Request, res: Response) => {
  const my = ownedBy(req);
  const page = await my.conversations.page(checkId(req.params.id));
  res.json(promptView(page.character, page.persona, page.conversation.settings, page.turns.length));
});

// What this conversation would send, against the model's context window.
app.get("/api/conversations/:id/tokens", async (req: Request, res: Response) => {
  const my = ownedBy(req);
  const page = await my.conversations.page(checkId(req.params.id));
  const { settings } = page.conversation;
  const system = buildSystem(page.character, page.persona, settings);
  try {
    const [inputTokens, window] = await Promise.all([
      countTokens(system, page.turns, settings),
      contextWindow(settings.model),
    ]);
    res.json({ inputTokens, contextWindow: window });
  } catch (err) {
    throw asStoreError(err);
  }
});

/**
 * Sends a message and reports the reply as it is written.
 *
 * Your message and the reply are written to the log together, once the reply is finished. That
 * way a send that fails leaves nothing behind and can simply be sent again, and a reply whose tab
 * was closed mid-stream is still saved — the server finishes it either way.
 *
 * Everything is checked before the stream headers go out: after that the status can no longer
 * change, so a failure has to travel as an event instead.
 */
app.post("/api/conversations/:id/turns", async (req: Request, res: Response) => {
  const { username, conversations } = ownedBy(req);
  const id = checkId(req.params.id);
  const text = required(object(req.body).text, LIMITS.message, "The message");
  const page = await conversations.page(id);
  const { settings } = page.conversation;
  const system = buildSystem(page.character, page.persona, settings);

  const release = busy.claim(username, id);

  const mine: Turn = {
    id: randomUUID(),
    at: new Date().toISOString(),
    role: "user",
    content: [{ type: "text", text }],
  };
  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    // Nothing in between should sit on this and buffer it.
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write(frame({ type: "start", turn: mine }));
  // A line starting with ":" is a comment; the page's reader skips it.
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": still writing\n\n");
  }, HEARTBEAT_MS);

  try {
    const reply = await streamReply(system, [...page.turns, mine], settings, (event) => {
      if (!res.writableEnded) res.write(frame(event));
    });
    await conversations.appendTurns(id, mine, reply);
    if (!res.writableEnded) res.write(frame({ type: "done", turn: reply }));
  } catch (err) {
    const failure = asStoreError(err);
    if (!res.writableEnded) res.write(frame({ type: "error", error: failure.message, code: failure.code }));
  } finally {
    clearInterval(heartbeat);
    release();
  }
  res.end();
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "No such API" } satisfies ApiError);
});

// Errors as JSON. StoreError is a refused request; express.json's own errors carry a status.
// Anything else is a bug: logged, and answered without details.
const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  // A reply that already started streaming can only be closed.
  if (res.headersSent) return void res.end();
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

const server = app.listen(PORT, HOST, (err) => {
  if (err) {
    console.error(`Could not listen on ${HOST}:${PORT}: ${err.message}`);
    process.exit(1);
  }
  console.log(`Listening on http://${HOST}:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
