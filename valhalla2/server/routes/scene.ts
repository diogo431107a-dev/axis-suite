// A moment worked out: the scene, and how each line of a reply is said. Looking (GET) never asks
// Claude; reading (POST) uses the kept reading while it holds; reading again asks afresh; and you
// can correct it (PUT).
import { Router, type Request, type Response } from "express";
import { id as checkId, messageId } from "../check.ts";
import type { Services } from "../services.ts";

export function sceneRoutes(s: Services): Router {
  const routes = Router();

  /** The message named in the path, and what is asked about it. */
  function momentOf(req: Request) {
    const my = s.ownedBy(req);
    const chat = my.chats.get(checkId(req.params.id));
    const companion = my.companions.get(chat.companionId);
    const tree = my.chats.tree(chat.id);
    const at = messageId(req.params.messageId);
    tree.get(at);
    return { at, request: s.moment(companion, tree.pathTo(at)) };
  }

  routes.get("/chats/:id/messages/:messageId/scene", (req: Request, res: Response) => {
    const { at, request } = momentOf(req);
    res.json({ scene: s.scenes.peek(at, request) });
  });

  routes.post("/chats/:id/messages/:messageId/scene", async (req: Request, res: Response) => {
    const { at, request } = momentOf(req);
    res.json(await s.scenes.of(at, request));
  });

  routes.post("/chats/:id/messages/:messageId/scene/again", async (req: Request, res: Response) => {
    const { at, request } = momentOf(req);
    res.json(await s.scenes.of(at, request, true));
  });

  routes.put("/chats/:id/messages/:messageId/scene", (req: Request, res: Response) => {
    const { at, request } = momentOf(req);
    res.json(s.scenes.save(at, request, req.body));
  });

  return routes;
}
