// What you do to the messages of a chat: choose a version, branch, edit, delete, say why replies
// aren't working, like a reply, pin words. Each answers with the chat as it now is.
import { Router, type Request, type Response } from "express";
import { LIMITS } from "../../shared/protocol.ts";
import { id as checkId, messageId, object, required, text } from "../check.ts";
import type { Services } from "../services.ts";
import { forgetDeletedSpeech } from "../speech/store.ts";

export function messageRoutes(s: Services): Router {
  const routes = Router();

  /** Selects a message: the path now runs through it, down to the newest line below it. */
  routes.post("/chats/:id/select", (req: Request, res: Response) => {
    const my = s.ownedBy(req);
    const id = checkId(req.params.id);
    my.chats.tree(id).select(messageId(object(req.body).messageId));
    res.json(my.chats.page(id));
  });

  /** Ends the selected path at a message, so what you say next branches off there. */
  routes.post("/chats/:id/branch", (req: Request, res: Response) => {
    const my = s.ownedBy(req);
    const id = checkId(req.params.id);
    my.chats.tree(id).branchFrom(messageId(object(req.body).messageId));
    res.json(my.chats.page(id));
  });

  routes.patch("/chats/:id/messages/:messageId", (req: Request, res: Response) => {
    const my = s.ownedBy(req);
    const id = checkId(req.params.id);
    my.chats
      .tree(id)
      .edit(messageId(req.params.messageId), required(object(req.body).text, LIMITS.message, "The message"));
    res.json(my.chats.page(id));
  });

  routes.delete("/chats/:id/messages/:messageId", (req: Request, res: Response) => {
    const my = s.ownedBy(req);
    const id = checkId(req.params.id);
    my.chats.tree(id).remove(messageId(req.params.messageId));
    for (const file of forgetDeletedSpeech(s.db, id)) s.speechFiles.remove(file);
    res.json(my.chats.page(id));
  });

  /** Why the replies under a message keep being rejected; a null reason means "rather not say". */
  routes.post("/chats/:id/feedback", (req: Request, res: Response) => {
    const my = s.ownedBy(req);
    const id = checkId(req.params.id);
    const body = object(req.body);
    const parentId = body.parentId === null || body.parentId === undefined ? null : messageId(body.parentId);
    const reason =
      body.reason === null || body.reason === undefined ? null : text(body.reason, LIMITS.reason, "The reason") || null;
    my.chats.feedback(id, parentId, reason);
    res.json(my.chats.page(id));
  });

  /**
   * Likes a reply, `{ comment? }`: with a comment it is praise the memory model reads at its next
   * run; without one it is only for you. Liking it again changes the comment.
   */
  routes.put("/chats/:id/messages/:messageId/like", (req: Request, res: Response) => {
    const my = s.ownedBy(req);
    const id = checkId(req.params.id);
    my.likes.like(id, messageId(req.params.messageId), req.body === undefined ? undefined : object(req.body).comment);
    res.json(my.chats.page(id));
  });

  /** Takes a like back. */
  routes.delete("/chats/:id/messages/:messageId/like", (req: Request, res: Response) => {
    const my = s.ownedBy(req);
    const id = checkId(req.params.id);
    my.likes.unlike(id, messageId(req.params.messageId));
    res.json(my.chats.page(id));
  });

  /** Pins words from a message: `{ messageId, speaker, text }`. This chat sees it on its next turn. */
  routes.post("/chats/:id/pins", (req: Request, res: Response) => {
    const my = s.ownedBy(req);
    const id = checkId(req.params.id);
    my.pins.add(id, req.body);
    res.json(my.chats.page(id));
  });

  return routes;
}
