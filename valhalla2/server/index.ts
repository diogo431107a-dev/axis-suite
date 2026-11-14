import express, { type ErrorRequestHandler, type Request, type Response } from "express";
import { heimdallAuth, knownUsers } from "@axis-suite/heimdall-client/server";
import { randomUUID } from "node:crypto";
import {
  LIMITS,
  ORIENTATIONS,
  PICTURE_KINDS,
  PICTURE_SIZES,
  type ApiError,
  type Companion,
  type Health,
  type MemoryPage,
  type Orientation,
  type PictureDraftReply,
  type PictureKind,
  type StreamEvent,
} from "../shared/protocol.ts";
import { frame } from "../shared/sse.ts";
import { createBusy } from "./busy.ts";
import { createChats } from "./chat/chats.ts";
import { generate, prepare, send, type TurnContext } from "./chat/turn.ts";
import {
  asStoreError,
  contextWindow,
  countTokens,
  hasApiKey,
  keySource,
  runMemoryModel,
  streamReply,
  writePicturePrompt,
} from "./claude.ts";
import { id as checkId, messageId, object, oneOf, required, text } from "./check.ts";
import { createCivitai, PICTURE_DEFAULTS, randomSeed } from "./civitai.ts";
import { loadCivitaiKey } from "./civitaiKey.ts";
import { createCompanions } from "./companions.ts";
import { config } from "./config.ts";
import { join } from "node:path";
import { backUp, backups, startDailyBackups } from "./backup.ts";
import { DB_FILE, openDatabase, removeUnknownOwners, STATE_DIR } from "./db.ts";
import { invalid, StoreError } from "./errors.ts";
import { memoryBusy, withMemoryLock } from "./memory/lock.ts";
import { createScheduler } from "./memory/scheduler.ts";
import { createMemoryService } from "./memory/service.ts";
import { createMemory } from "./memory/store.ts";
import { createPictureFiles, PICTURES_DIR } from "./pictures/files.ts";
import { createPainter } from "./pictures/painter.ts";
import { sceneRequest, type Scene } from "./pictures/scene.ts";
import { createPictures, knownFiles } from "./pictures/store.ts";
import { asParams, promptView } from "./prompt.ts";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3016);

const db = openDatabase(DB_FILE);
console.log(`Everyone's companions, chats and memory: ${DB_FILE}`);
console.log(`Claude API key: ${keySource()}`);

// A run of the memory model the server was stopped in the middle of changed nothing (it worked
// on a scratch copy); clear the copy away and say so on the run.
{
  const leftover = db.prepare("SELECT id FROM memory_runs WHERE ok IS NULL").all() as { id: number }[];
  for (const table of ["memory_files", "memory_versions"]) {
    db.prepare(`DELETE FROM ${table} WHERE space LIKE 'scratch:%' OR space LIKE 'rebuild:%'`).run();
  }
  db.prepare(
    "UPDATE memory_runs SET ok = 0, error = 'The server stopped before this run finished; nothing was changed.', finished_at = ? WHERE ok IS NULL",
  ).run(new Date().toISOString());
  if (leftover.length > 0)
    console.log(`${leftover.length} memory run(s) cut short by the last stop; nothing was changed`);
}

const memory = createMemory(db, config.memory);
const memoryService = createMemoryService(db, memory, config.memory);
const scheduler = createScheduler({
  db,
  memory,
  limits: config.memory,
  run: runMemoryModel,
  maxIterations: config.memoryIterations,
  idleMinutes: config.idleMinutes,
  cleanup: config.cleanup,
  partTokens: config.windowTokens,
});
scheduler.start();

const BACKUP_DIR = join(STATE_DIR, "backups");
const stopBackups = startDailyBackups(db, BACKUP_DIR, config.backupsKept);

// Someone removed from Heimdall leaves nothing behind. Without the list (development, or Heimdall
// not installed yet) nothing is deleted.
const known = knownUsers();
if (known) {
  for (const name of removeUnknownOwners(db, known)) {
    console.log(`Deleted the companions and chats of ${name}, who is no longer in Heimdall`);
  }
}

// Pictures: files in their own folder, made by CivitAI when the server has a key for it.
const pictureFiles = createPictureFiles();
{
  const swept = pictureFiles.sweep(knownFiles(db));
  if (swept > 0) console.log(`Deleted ${swept} picture file(s) nothing refers to any more`);
}
const civitaiKey = loadCivitaiKey();
const painter = civitaiKey
  ? createPainter({ db, civitai: createCivitai({ token: civitaiKey.token }), files: pictureFiles })
  : null;
console.log(
  painter
    ? `Pictures: ${PICTURES_DIR}, made by CivitAI (key from ${civitaiKey?.from === "credential" ? "the systemd credential" : "CIVITAI_API_KEY"})`
    : "Pictures: off, no CivitAI key",
);
if (painter) {
  const resumed = painter.resume();
  if (resumed > 0) console.log(`Picking up ${resumed} picture(s) the last stop cut short`);
}

const auth = heimdallAuth();

/** The signed-in person's own companions and chats. Made per request: they hold no state. */
function ownedBy(req: Request) {
  const { username } = auth.user(req);
  const companions = createCompanions(db, username, config.defaults);
  return {
    username,
    companions,
    chats: createChats(db, username, companions, config.swipeAsk),
    pictures: createPictures(db, username),
  };
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
  res.json({ apiKey: hasApiKey(), pictures: painter !== null, defaults: config.defaults } satisfies Health);
});

// Companions
app.get("/api/companions", (req: Request, res: Response) => {
  res.json(ownedBy(req).companions.list());
});
app.put("/api/companions/:id", (req: Request, res: Response) => {
  res.json(ownedBy(req).companions.save(checkId(req.params.id), req.body));
});
app.delete("/api/companions/:id", (req: Request, res: Response) => {
  const my = ownedBy(req);
  const id = checkId(req.params.id);
  // The rows go with the companion; their files are deleted here.
  const files = my.pictures.filesOf(id);
  my.companions.remove(id);
  for (const file of files) pictureFiles.remove(file);
  res.status(204).end();
});

// Chats
app.get("/api/chats", (req: Request, res: Response) => {
  res.json(ownedBy(req).chats.list());
});
app.post("/api/chats", (req: Request, res: Response) => {
  const chat = ownedBy(req).chats.create(req.body);
  // The greeting should know everything: fold the companion's other chats in first.
  scheduler.othersOf(chat.companionId, chat.id);
  res.status(201).json(chat);
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

/** The parts of a request that don't stream: the chat, its companion, its tree, and how to prepare it. */
function chatParts(req: Request) {
  const my = ownedBy(req);
  const chat = my.chats.get(checkId(req.params.id));
  const companion = my.companions.get(chat.companionId);
  const tree = my.chats.tree(chat.id);
  const base = {
    db,
    chatId: chat.id,
    companion,
    memory,
    window: { tokens: config.windowTokens, chunk: config.windowChunk },
    onSlide: () => scheduler.soon(chat.id),
  };
  return { my, chat, companion, tree, base };
}

// The request exactly as it will be sent. Nothing is assembled out of sight.
app.get("/api/chats/:id/prompt", (req: Request, res: Response) => {
  const { companion, tree, base } = chatParts(req);
  const { system, messages } = prepare(base, tree.activePath(), undefined, false);
  res.json(promptView(companion, system, messages));
});

// What this chat would send, against the model's context window.
app.get("/api/chats/:id/tokens", async (req: Request, res: Response) => {
  const { companion, tree, base } = chatParts(req);
  const { system, messages } = prepare(base, tree.activePath(), undefined, false);
  try {
    const [inputTokens, window] = await Promise.all([
      countTokens(system, asParams(messages), companion.settings),
      contextWindow(companion.settings.model),
    ]);
    res.json({ inputTokens, contextWindow: window });
  } catch (err) {
    throw asStoreError(err);
  }
});

/** What a streamed reply needs, checked and claimed before the stream starts. */
function turnFor(req: Request) {
  const { my, chat, companion, tree, base } = chatParts(req);
  const release = busy.claim(my.username, chat.id);
  const context = (onEvent: (event: StreamEvent) => void): TurnContext => ({
    ...base,
    tree,
    write: streamReply,
    onEvent,
  });
  return { tree, companion, release, context };
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
  const { tree, companion, release, context } = turnFor(req);
  try {
    if (parentId !== null) tree.get(parentId);
  } catch (err) {
    release();
    throw err;
  }
  await stream(res, release, async (tell) => {
    if (parentId === null && memoryBusy(companion.id)) {
      // A greeting is written knowing everything: it waits for memory to catch up first.
      tell({ type: "remembering" });
      await withMemoryLock(companion.id, () => undefined);
    }
    const answered = await generate(context(tell), parentId);
    tell({ type: "done", message: answered });
  });
});

/** Folds the chat into the companion's memory now, and says how that went. */
app.post("/api/chats/:id/consolidate", async (req: Request, res: Response) => {
  const { my, chat } = chatParts(req);
  const outcome = await scheduler.now(chat.id);
  res.json({ outcome, page: my.chats.page(chat.id) });
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

// A companion's memory: its files, their history, and the runs of the memory model.
function companionOf(req: Request) {
  return ownedBy(req).companions.get(checkId(req.params.id));
}
const versionId = (raw: unknown): number => {
  const n = typeof raw === "string" && /^[0-9]{1,15}$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : invalid("That version id isn't valid");
};

const memoryPage = (companion: Companion): MemoryPage => ({
  ...memoryService.page(companion),
  rebuilding: scheduler.rebuilding(companion.id),
  backups: backups(BACKUP_DIR).map(({ day, bytes }) => ({ day, bytes })),
});

app.get("/api/companions/:id/memory", (req: Request, res: Response) => {
  res.json(memoryPage(companionOf(req)));
});
/** Tidies the companion's memory now, and says how that went. */
app.post("/api/companions/:id/memory/tidy", async (req: Request, res: Response) => {
  const companion = companionOf(req);
  const outcome = await scheduler.tidy(companion.id);
  res.json({ outcome, page: memoryPage(companion) });
});
/**
 * Starts rebuilding the companion's memory from every chat. It can take minutes, so this answers
 * at once; the page watches the runs come in.
 */
app.post("/api/companions/:id/memory/rebuild", (req: Request, res: Response) => {
  const companion = companionOf(req);
  scheduler.rebuild(companion.id).then(
    (outcome) => {
      if (outcome.kind === "failed") console.error(`Rebuilding the memory of ${companion.id} failed: ${outcome.error}`);
    },
    (err: unknown) => console.error(`Rebuilding the memory of ${companion.id} failed:`, err),
  );
  res.status(202).json(memoryPage(companion));
});
/** Backs the whole database up now, as today's backup. */
app.post("/api/companions/:id/memory/backup", (req: Request, res: Response) => {
  const companion = companionOf(req);
  backUp(db, BACKUP_DIR, config.backupsKept);
  res.json(memoryPage(companion));
});
app.get("/api/companions/:id/memory/file", (req: Request, res: Response) => {
  res.json(memoryService.file(companionOf(req), req.query.path));
});
app.put("/api/companions/:id/memory/file", async (req: Request, res: Response) => {
  const body = object(req.body);
  if (typeof body.content !== "string") invalid("The file's text isn't valid");
  res.json(await memoryService.save(companionOf(req), body.path, body.content));
});
app.delete("/api/companions/:id/memory/file", async (req: Request, res: Response) => {
  await memoryService.remove(companionOf(req), req.query.path);
  res.status(204).end();
});
app.get("/api/companions/:id/memory/versions", (req: Request, res: Response) => {
  res.json(memoryService.versions(companionOf(req), req.query.path));
});
app.get("/api/companions/:id/memory/versions/:versionId", (req: Request, res: Response) => {
  res.json(memoryService.version(companionOf(req), versionId(req.params.versionId)));
});
app.post("/api/companions/:id/memory/versions/:versionId/revert", async (req: Request, res: Response) => {
  await memoryService.revert(companionOf(req), versionId(req.params.versionId));
  res.status(204).end();
});

// Pictures of a companion: a profile picture from its page, a chat picture from a message. Claude
// writes the prompt, you look it over, and CivitAI makes the picture in the background.

/** CivitAI, or a refusal when the server has no key for it. */
function needPictures() {
  return painter ?? invalid("This Valhalla 2 has no CivitAI key, so it can't make pictures");
}

/** The chat and message a chat picture is of, checked against the companion. */
function sceneOf(req: Request, companion: Companion, body: Record<string, unknown>) {
  const my = ownedBy(req);
  const chat = my.chats.get(checkId(body.chatId));
  if (chat.companionId !== companion.id) invalid("That chat is with another companion");
  const tree = my.chats.tree(chat.id);
  const at = messageId(body.messageId);
  tree.get(at);
  return { chat, messageId: at, path: tree.pathTo(at) };
}

app.post("/api/companions/:id/pictures/prompt", async (req: Request, res: Response) => {
  needPictures();
  const companion = companionOf(req);
  const body = object(req.body);
  const kind = oneOf<PictureKind>(body.kind, PICTURE_KINDS, "The kind of picture");
  const hint = body.hint === undefined ? "" : text(body.hint, LIMITS.pictureHint, "The note");
  const scene: Scene = kind === "profile" ? { kind } : { kind, path: sceneOf(req, companion, body).path };
  const draft = await writePicturePrompt(
    sceneRequest(companion, scene, hint, config.pictures.recent),
    config.pictures.promptModel,
  );
  res.json(draft satisfies PictureDraftReply);
});

app.post("/api/companions/:id/pictures", (req: Request, res: Response) => {
  const paint = needPictures();
  const companion = companionOf(req);
  const body = object(req.body);
  const kind = oneOf<PictureKind>(body.kind, PICTURE_KINDS, "The kind of picture");
  const from = kind === "chat" ? sceneOf(req, companion, body) : null;
  const orientation = oneOf<Orientation>(body.orientation, ORIENTATIONS, "The orientation");
  const picture = ownedBy(req).pictures.create({
    id: randomUUID(),
    companionId: companion.id,
    kind,
    chatId: from?.chat.id ?? null,
    messageId: from?.messageId ?? null,
    prompt: required(body.prompt, LIMITS.picturePrompt, "The prompt"),
    negativePrompt: text(body.negativePrompt ?? "", LIMITS.picturePrompt, "The negative prompt"),
    orientation,
    caption: text(body.caption ?? "", LIMITS.pictureCaption, "The caption"),
    params: {
      model: config.pictures.model,
      ...PICTURE_SIZES[orientation],
      ...PICTURE_DEFAULTS,
      seed: randomSeed(),
    },
  });
  void paint.paint(picture.id, null);
  res.status(201).json(picture);
});

app.get("/api/companions/:id/pictures", (req: Request, res: Response) => {
  const companion = companionOf(req);
  res.json(ownedBy(req).pictures.of(companion.id));
});

app.get("/api/pictures/:id", (req: Request, res: Response) => {
  res.json(ownedBy(req).pictures.get(checkId(req.params.id)));
});

// The picture itself, from disk, to its owner only. It never changes: a new picture is a new id.
app.get("/api/pictures/:id/file", (req: Request, res: Response) => {
  const file = ownedBy(req).pictures.fileOf(checkId(req.params.id));
  if (!file) return void res.status(404).json({ error: "That picture isn't ready" } satisfies ApiError);
  res.sendFile(
    pictureFiles.path(file),
    {
      cacheControl: false,
      headers: {
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    },
    (err) => {
      // Its file is gone (deleted by hand, say), or the download was cut off.
      if (err && !res.headersSent) res.status(404).json({ error: "No such picture" } satisfies ApiError);
    },
  );
});

app.delete("/api/pictures/:id", (req: Request, res: Response) => {
  const file = ownedBy(req).pictures.remove(checkId(req.params.id));
  if (file) pictureFiles.remove(file);
  res.status(204).end();
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
    scheduler.stop();
    stopBackups();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
