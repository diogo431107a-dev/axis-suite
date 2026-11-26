// Chats: listing, opening, changing and deleting them; what they send; and asking for replies.
import { Router, type Request, type Response } from "express";
import { LIMITS, type StreamEvent } from "../../shared/protocol.ts";
import { generate, prepare, send, type TurnContext } from "../chat/turn.ts";
import { apiError, tokensFor, writeReply } from "../chat/write.ts";
import { id as checkId, messageId, object, required } from "../check.ts";
import { config } from "../config.ts";
import { stream } from "../http/stream.ts";
import { memoryBusy, withMemoryLock } from "../memory/lock.ts";
import { asParams, promptView } from "../prompt.ts";
import type { Services } from "../services.ts";
import { speechFilesOf } from "../speech/store.ts";

export function chatRoutes(s: Services): Router {
  const routes = Router();

  routes.get("/chats", (req: Request, res: Response) => {
    res.json(s.ownedBy(req).chats.list());
  });

  routes.post("/chats", (req: Request, res: Response) => {
    const chat = s.ownedBy(req).chats.create(req.body);
    // The greeting should know everything: fold the companion's other chats in first.
    s.scheduler.othersOf(chat.companionId, chat.id);
    res.status(201).json(chat);
  });

  routes.get("/chats/:id", (req: Request, res: Response) => {
    res.json(s.ownedBy(req).chats.page(checkId(req.params.id)));
  });

  routes.patch("/chats/:id", (req: Request, res: Response) => {
    res.json(s.ownedBy(req).chats.change(checkId(req.params.id), req.body));
  });

  routes.delete("/chats/:id", (req: Request, res: Response) => {
    const my = s.ownedBy(req);
    const id = checkId(req.params.id);
    my.chats.get(id);
    const audio = speechFilesOf(s.db, { chatId: id });
    my.chats.remove(id);
    for (const file of audio) s.speechFiles.remove(file);
    res.status(204).end();
  });

  /** The parts of a request that don't stream: the chat, its companion, its tree, and how to prepare it. */
  function chatParts(req: Request) {
    const my = s.ownedBy(req);
    const chat = my.chats.get(checkId(req.params.id));
    const companion = my.companions.get(chat.companionId);
    const tree = my.chats.tree(chat.id);
    const base = {
      db: s.db,
      chatId: chat.id,
      companion,
      memory: s.memory,
      window: { tokens: config.windowTokens, chunk: config.windowChunk },
      onSlide: () => s.scheduler.soon(chat.id),
    };
    return { my, chat, companion, tree, base };
  }

  // The request exactly as it will be sent. Nothing is assembled out of sight.
  routes.get("/chats/:id/prompt", (req: Request, res: Response) => {
    const { companion, tree, base } = chatParts(req);
    const { system, messages } = prepare(base, tree.activePath(), undefined, false);
    res.json(promptView(companion, system, messages));
  });

  // What this chat would send, against the model's context window.
  routes.get("/chats/:id/tokens", async (req: Request, res: Response) => {
    const { companion, tree, base } = chatParts(req);
    const { system, messages } = prepare(base, tree.activePath(), undefined, false);
    try {
      res.json(await tokensFor(system, asParams(messages), companion.settings));
    } catch (err) {
      throw apiError(err);
    }
  });

  /** What a streamed reply needs, checked and claimed before the stream starts. */
  function turnFor(req: Request) {
    const { my, chat, companion, tree, base } = chatParts(req);
    const release = s.busy.claim(my.username, chat.id);
    const context = (onEvent: (event: StreamEvent) => void): TurnContext => ({
      ...base,
      tree,
      write: writeReply,
      onEvent,
    });
    return { tree, companion, release, context };
  }

  /** Says something at the end of the selected path and streams the answer. */
  routes.post("/chats/:id/send", async (req: Request, res: Response) => {
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
  routes.post("/chats/:id/generate", async (req: Request, res: Response) => {
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
  routes.post("/chats/:id/consolidate", async (req: Request, res: Response) => {
    const { my, chat } = chatParts(req);
    const outcome = await s.scheduler.now(chat.id);
    res.json({ outcome, page: my.chats.page(chat.id) });
  });

  return routes;
}
