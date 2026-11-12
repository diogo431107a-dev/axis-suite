import express, { type ErrorRequestHandler, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { LIMITS, type ApiError, type Turn } from "../shared/protocol.ts";
import { frame } from "../shared/sse.ts";
import { asStoreError, contextWindow, countTokens, hasApiKeyInEnvironment, streamReply } from "./claude.ts";
import { id as checkId, object, required } from "./check.ts";
import { StoreError } from "./errors.ts";
import { DATA_DIR } from "./files.ts";
import { createConversations } from "./log.ts";
import { buildSystem, promptView } from "./prompt.ts";
import { createStore } from "./store.ts";

// Named for Valhalla, not the usual HOST/PORT: whatever starts the dev servers may already be
// setting those for something else, and then the API would quietly try to listen on its port.
const HOST = process.env.VALHALLA_HOST ?? "127.0.0.1";
const PORT = Number(process.env.VALHALLA_PORT ?? 3100);

const store = createStore();
const conversations = createConversations(store);

console.log(`Characters, personas and conversations: ${DATA_DIR}`);
if (!hasApiKeyInEnvironment()) {
  console.log("No ANTHROPIC_API_KEY set. A profile from `ant auth login` is used instead, if there is one.");
}

const app = express();
app.disable("x-powered-by");

// Liveness check, for whatever starts this.
app.get("/healthz", (_req, res) => {
  res.type("text/plain").set("Cache-Control", "no-store").send("ok");
});

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Valhalla listens on 127.0.0.1 and serves one person, so there is nobody to sign in as. This
// still refuses a write that came from another page in the browser, which costs a few lines.
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (READ_METHODS.has(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    let host: string | undefined;
    try {
      host = new URL(origin).host;
    } catch {
      // Malformed: treat it as foreign.
    }
    if (host !== req.headers.host) {
      return void res.status(403).json({ error: "Cross-origin request refused" } satisfies ApiError);
    }
  }
  const type = req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  if (req.method !== "DELETE" && type !== "application/json") {
    return void res.status(415).json({ error: "Expected application/json" } satisfies ApiError);
  }
  next();
});
// A definition can be long: three 20,000-character fields plus settings.
app.use("/api", express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ apiKeyInEnvironment: hasApiKeyInEnvironment(), dataDir: DATA_DIR });
});

// Characters
app.get("/api/characters", async (_req, res) => {
  res.json(await store.characters());
});
app.put("/api/characters/:id", async (req, res) => {
  res.json(await store.saveCharacter(checkId(req.params.id), req.body));
});
app.delete("/api/characters/:id", async (req, res) => {
  const id = checkId(req.params.id);
  await conversations.refuseIfUsed("character", id);
  await store.removeCharacter(id);
  res.status(204).end();
});

// Personas
app.get("/api/personas", async (_req, res) => {
  res.json(await store.personas());
});
app.put("/api/personas/:id", async (req, res) => {
  res.json(await store.savePersona(checkId(req.params.id), req.body));
});
app.delete("/api/personas/:id", async (req, res) => {
  const id = checkId(req.params.id);
  await conversations.refuseIfUsed("persona", id);
  await store.removePersona(id);
  res.status(204).end();
});

// Conversations
app.get("/api/conversations", async (_req, res) => {
  res.json(await conversations.list());
});
app.post("/api/conversations", async (req, res) => {
  res.status(201).json(await conversations.create(req.body));
});
app.get("/api/conversations/:id", async (req, res) => {
  res.json(await conversations.page(checkId(req.params.id)));
});
app.patch("/api/conversations/:id/settings", async (req, res) => {
  res.json(await conversations.changeSettings(checkId(req.params.id), req.body));
});
app.patch("/api/conversations/:id", async (req, res) => {
  res.json(await conversations.rename(checkId(req.params.id), req.body));
});
app.delete("/api/conversations/:id", async (req, res) => {
  await conversations.remove(checkId(req.params.id));
  res.status(204).end();
});

// The request exactly as it will be sent. Nothing is assembled out of sight.
app.get("/api/conversations/:id/prompt", async (req, res) => {
  const page = await conversations.page(checkId(req.params.id));
  res.json(promptView(page.character, page.persona, page.conversation.settings, page.turns.length));
});

// What this conversation would send, against the model's context window.
app.get("/api/conversations/:id/tokens", async (req, res) => {
  const page = await conversations.page(checkId(req.params.id));
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
  const id = checkId(req.params.id);
  const text = required(object(req.body).text, LIMITS.message, "The message");
  const page = await conversations.page(id);
  const { settings } = page.conversation;
  const system = buildSystem(page.character, page.persona, settings);

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

  try {
    const reply = await streamReply(system, [...page.turns, mine], settings, (event) => {
      res.write(frame(event));
    });
    await conversations.appendTurns(id, mine, reply);
    res.write(frame({ type: "done", turn: reply }));
  } catch (err) {
    const failure = asStoreError(err);
    res.write(frame({ type: "error", error: failure.message, code: failure.code }));
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
