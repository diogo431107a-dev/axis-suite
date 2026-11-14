import express, { type ErrorRequestHandler, type Request, type Response } from "express";
import { heimdallAuth, knownUsers } from "@axis-suite/heimdall-client/server";
import { LIMITS, type ApiError, type Health, type StreamEvent } from "../shared/protocol.ts";
import { frame } from "../shared/sse.ts";
import { createBusy } from "./busy.ts";
import { createChats } from "./chat/chats.ts";
import { generate, send, type TurnContext } from "./chat/turn.ts";
import { asStoreError, contextWindow, countTokens, hasApiKey, keySource, streamReply } from "./claude.ts";
import { id as checkId, messageId, object, required, text } from "./check.ts";
import { createCompanions } from "./companions.ts";
import { config } from "./config.ts";
import { DB_FILE, openDatabase, removeUnknownOwners } from "./db.ts";
import { StoreError } from "./errors.ts";
import { asParams, buildSystem, outgoing, promptView } from "./prompt.ts";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3016);

const db = openDatabase(DB_FILE);
console.log(`Everyone's companions and chats: ${DB_FILE}`);
console.log(`Claude API key: ${keySource()}`);

// Someone removed from Heimdall leaves nothing behind. Without the list (development, or Heimdall
// not installed yet) nothing is deleted.
const known = knownUsers();
if (known) {
  for (const name of removeUnknownOwners(db, known)) {
    console.log(`Deleted the companions and chats of ${name}, who is no longer in Heimdall`);
  }
}

const auth = heimdallAuth();

/** The signed-in person's own companions and chats. Made per request: they hold no state. */
function ownedBy(req: Request) {
  const { username } = auth.user(req);
  const companions = createCompanions(db, username, config.defaults);
  return { username, companions, chats: createChats(db, username, companions, config.swipeAsk) };
}

const busy = createBusy();

// While Claude thinks, nothing is written for a while. A comment line now and then keeps every
// proxy in between from deciding the stream has gone quiet for good.
const HEARTBEAT_MS = 20_000;

/**
 * Answers with a reply as it is written. Everything that can be refused is checked before this
 * is called: once the stream headers go out the status can no longer change, so a failure has to
 * travel as an event instead.
 */
async function stream(
  res: Response,
  release: () => void,
  work: (onEvent: (event: StreamEvent) => void) => Promise<void>,
): Promise<void> {
  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    // Nothing in between should sit on this and buffer it.
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  const tell = (event: StreamEvent) => {
    if (!res.writableEnded) res.write(frame(event));
  };
  tell({ type: "start" });
  // A line starting with ":" is a comment; the page's reader skips it.
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": still writing\n\n");
  }, HEARTBEAT_MS);
  try {
    await work(tell);
  } catch (err) {
    const failure = asStoreError(err);
    tell({ type: "error", error: failure.message, code: failure.code });
  } finally {
    clearInterval(heartbeat);
    release();
  }
  res.end();
}

const app = express();
app.disable("x-powered-by");

// Liveness check, for whatever starts this.
app.get("/healthz", (_req, res) => {
  res.type("text/plain").set("Cache-Control", "no-store").send("ok");
});

// Every API call is someone signed in to Heimdall, writing from Valhalla 2's own page.
app.use("/api", auth.sameOriginWrites, auth.requireUser, (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
// A profile can be long: 60,000 characters plus settings and prompt texts.
app.use("/api", express.json({ limit: "1mb" }));

app.get("/api/me", auth.me);

app.get("/api/health", (_req, res) => {
  res.json({ apiKey: hasApiKey(), defaults: config.defaults } satisfies Health);
});

// Companions
app.get("/api/companions", (req: Request, res: Response) => {
  res.json(ownedBy(req).companions.list());
});
app.put("/api/companions/:id", (req: Request, res: Response) => {
  res.json(ownedBy(req).companions.save(checkId(req.params.id), req.body));
});
app.delete("/api/companions/:id", (req: Request, res: Response) => {
  ownedBy(req).companions.remove(checkId(req.params.id));
  res.status(204).end();
});

// Chats
app.get("/api/chats", (req: Request, res: Response) => {
  res.json(ownedBy(req).chats.list());
});
app.post("/api/chats", (req: Request, res: Response) => {
  res.status(201).json(ownedBy(req).chats.create(req.body));
});
app.get("/api/chats/:id", (req: Request, res: Response) => {
  res.json(ownedBy(req).chats.page(checkId(req.params.id)));
});
app.patch("/api/chats/:id", (req: Request, res: Response) => {
  res.json(ownedBy(req).chats.change(checkId(req.params.id), req.body));
});
app.delete("/api/chats/:id", (req: Request, res: Response) => {
  ownedBy(req).chats.remove(checkId(req.params.id));
  res.status(204).end();
});

// The request exactly as it will be sent. Nothing is assembled out of sight.
app.get("/api/chats/:id/prompt", (req: Request, res: Response) => {
  const my = ownedBy(req);
  const chat = my.chats.get(checkId(req.params.id));
  const companion = my.companions.get(chat.companionId);
  res.json(promptView(companion, my.chats.tree(chat.id).activePath()));
});

// What this chat would send, against the model's context window.
app.get("/api/chats/:id/tokens", async (req: Request, res: Response) => {
  const my = ownedBy(req);
  const chat = my.chats.get(checkId(req.params.id));
  const companion = my.companions.get(chat.companionId);
  const messages = asParams(outgoing(my.chats.tree(chat.id).activePath()));
  try {
    const [inputTokens, window] = await Promise.all([
      countTokens(buildSystem(companion), messages, companion.settings),
      contextWindow(companion.settings.model),
    ]);
    res.json({ inputTokens, contextWindow: window });
  } catch (err) {
    throw asStoreError(err);
  }
});

/** What a streamed reply needs, checked and claimed before the stream starts. */
function turnFor(req: Request) {
  const my = ownedBy(req);
  const chat = my.chats.get(checkId(req.params.id));
  const companion = my.companions.get(chat.companionId);
  const tree = my.chats.tree(chat.id);
  const release = busy.claim(my.username, chat.id);
  const context = (onEvent: (event: StreamEvent) => void): TurnContext => ({
    db,
    tree,
    companion,
    write: streamReply,
    onEvent,
  });
  return { tree, release, context };
}

/** Says something at the end of the selected path and streams the answer. */
app.post("/api/chats/:id/send", async (req: Request, res: Response) => {
  const said = required(object(req.body).text, LIMITS.message, "The message");
  const { release, context } = turnFor(req);
  await stream(res, release, async (tell) => {
    const answered = await send(context(tell), said);
    tell({ type: "done", message: answered });
  });
});

/**
 * Writes a new reply under one of your messages, or a new greeting (parentId null), and streams
 * it. Another version of a reply — a swipe — is this, under the reply's parent.
 */
app.post("/api/chats/:id/generate", async (req: Request, res: Response) => {
  const body = object(req.body);
  const parentId = body.parentId === null || body.parentId === undefined ? null : messageId(body.parentId);
  const { tree, release, context } = turnFor(req);
  try {
    if (parentId !== null) tree.get(parentId);
  } catch (err) {
    release();
    throw err;
  }
  await stream(res, release, async (tell) => {
    const answered = await generate(context(tell), parentId);
    tell({ type: "done", message: answered });
  });
});

/** Selects a message: the path now runs through it, down to the newest line below it. */
app.post("/api/chats/:id/select", (req: Request, res: Response) => {
  const my = ownedBy(req);
  const id = checkId(req.params.id);
  my.chats.tree(id).select(messageId(object(req.body).messageId));
  res.json(my.chats.page(id));
});

/** Ends the selected path at a message, so what you say next branches off there. */
app.post("/api/chats/:id/branch", (req: Request, res: Response) => {
  const my = ownedBy(req);
  const id = checkId(req.params.id);
  my.chats.tree(id).branchFrom(messageId(object(req.body).messageId));
  res.json(my.chats.page(id));
});

app.patch("/api/chats/:id/messages/:messageId", (req: Request, res: Response) => {
  const my = ownedBy(req);
  const id = checkId(req.params.id);
  my.chats
    .tree(id)
    .edit(messageId(req.params.messageId), required(object(req.body).text, LIMITS.message, "The message"));
  res.json(my.chats.page(id));
});

app.delete("/api/chats/:id/messages/:messageId", (req: Request, res: Response) => {
  const my = ownedBy(req);
  const id = checkId(req.params.id);
  my.chats.tree(id).remove(messageId(req.params.messageId));
  res.json(my.chats.page(id));
});

/** Why the replies under a message keep being rejected; a null reason means "rather not say". */
app.post("/api/chats/:id/feedback", (req: Request, res: Response) => {
  const my = ownedBy(req);
  const id = checkId(req.params.id);
  const body = object(req.body);
  const parentId = body.parentId === null || body.parentId === undefined ? null : messageId(body.parentId);
  const reason =
    body.reason === null || body.reason === undefined ? null : text(body.reason, LIMITS.reason, "The reason") || null;
  my.chats.feedback(id, parentId, reason);
  res.json(my.chats.page(id));
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
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
