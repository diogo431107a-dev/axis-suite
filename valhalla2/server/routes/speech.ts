// Replies read aloud. Asking (POST) reads the reply if it isn't kept yet and says where the audio
// is; the page then plays that file (GET), which an <audio> element can fetch by itself.
import { Router, type Request, type Response } from "express";
import type { ApiError, SpeechReply } from "../../shared/protocol.ts";
import { id as checkId, messageId } from "../check.ts";
import { invalid } from "../errors.ts";
import { sendStored } from "../http/sendStored.ts";
import type { Services } from "../services.ts";
import { charsThisMonth, ownsSpeech } from "../speech/store.ts";

export function speechRoutes(s: Services): Router {
  const routes = Router();

  routes.post("/chats/:id/messages/:messageId/speech", async (req: Request, res: Response) => {
    const read = s.speech ?? invalid("This Valhalla 2 has no Azure Speech key, so it can't read aloud");
    const my = s.ownedBy(req);
    const id = checkId(req.params.id);
    const message = my.chats.tree(id).get(messageId(req.params.messageId));
    const { file } = await read.of(message);
    res.json({ url: `/api/speech/${file}`, monthChars: charsThisMonth(s.db) } satisfies SpeechReply);
  });

  // The audio itself, from disk, to its owner only. It never changes: other words are another file.
  routes.get("/speech/:file", (req: Request, res: Response) => {
    const file = String(req.params.file);
    if (!ownsSpeech(s.db, s.ownedBy(req).username, file)) {
      return void res.status(404).json({ error: "No such audio" } satisfies ApiError);
    }
    sendStored(res, s.speechFiles.path(file), "No such audio", "audio/mpeg");
  });

  return routes;
}
