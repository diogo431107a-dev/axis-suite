// How each line of a reply is said aloud: its tags. Worked out the first time a reply is read
// aloud with feeling (routes/speech.ts). Listing which replies have them and looking (GET) never
// ask a model; reading (POST) uses the kept reading while it holds; reading again asks afresh; and
// you can correct it (PUT).
import { Router, type Request, type Response } from "express";
import type { ToneList } from "../../shared/protocol.ts";
import { id as checkId, messageId } from "../check.ts";
import type { Services } from "../services.ts";
import { toneRequest } from "../tone/request.ts";

export function toneRoutes(s: Services): Router {
  const routes = Router();

  /** The reply named in the path, and what is asked about it. */
  function replyOf(req: Request) {
    const my = s.ownedBy(req);
    const chat = my.chats.get(checkId(req.params.id));
    const companion = my.companions.get(chat.companionId);
    const tree = my.chats.tree(chat.id);
    const at = messageId(req.params.messageId);
    tree.get(at);
    return { at, request: toneRequest(companion, tree.pathTo(at)) };
  }

  routes.get("/chats/:id/tones", (req: Request, res: Response) => {
    const chat = s.ownedBy(req).chats.get(checkId(req.params.id));
    res.json({ messageIds: s.tones.keptIn(chat.id) } satisfies ToneList);
  });

  routes.get("/chats/:id/messages/:messageId/tone", (req: Request, res: Response) => {
    const { at, request } = replyOf(req);
    res.json({ tone: s.tones.peek(at, request) });
  });

  routes.post("/chats/:id/messages/:messageId/tone", async (req: Request, res: Response) => {
    const { at, request } = replyOf(req);
    res.json(await s.tones.of(at, request));
  });

  routes.post("/chats/:id/messages/:messageId/tone/again", async (req: Request, res: Response) => {
    const { at, request } = replyOf(req);
    res.json(await s.tones.of(at, request, true));
  });

  routes.put("/chats/:id/messages/:messageId/tone", (req: Request, res: Response) => {
    const { at, request } = replyOf(req);
    res.json(s.tones.save(at, request, req.body));
  });

  return routes;
}
