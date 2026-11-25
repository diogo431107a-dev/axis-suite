// Replies read aloud. Asking (POST) reads the reply if it isn't kept yet and says where the audio
// is; the page then plays that file (GET), which an <audio> element can fetch by itself. A reply is
// read in its companion's voice, or the server's when it names none; the voices to choose from,
// and a short sample of one, are here too.
import { Router, type Request, type Response } from "express";
import { LIMITS, type ApiError, type SpeechReply, type VoiceList } from "../../shared/protocol.ts";
import { id as checkId, messageId, object, required, voice as checkVoice } from "../check.ts";
import { invalid, StoreError } from "../errors.ts";
import { sendStored } from "../http/sendStored.ts";
import type { Services } from "../services.ts";
import { SpeechError } from "../speech/azure.ts";
import { charsThisMonth, ownsSpeech } from "../speech/store.ts";

/** Azure's own failures as refusals the page shows, word for word. */
async function asked<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof SpeechError) throw new StoreError(502, err.message, "api");
    throw err;
  }
}

export function speechRoutes(s: Services): Router {
  const routes = Router();

  /** Azure Speech, or a refusal when the server has no key for it. */
  const needSpeech = () => s.speech ?? invalid("This Valhalla 2 has no Azure Speech key, so it can't read aloud");

  routes.post("/chats/:id/messages/:messageId/speech", async (req: Request, res: Response) => {
    const read = needSpeech();
    const my = s.ownedBy(req);
    const id = checkId(req.params.id);
    const chat = my.chats.get(id);
    const message = my.chats.tree(id).get(messageId(req.params.messageId));
    const voice = my.companions.get(chat.companionId).voice ?? undefined;
    const { file } = await asked(() => read.of(message, voice));
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

  /** The voices a companion can be read aloud in. */
  routes.get("/voices", async (_req: Request, res: Response) => {
    const read = needSpeech();
    res.json({ voices: await asked(() => read.voices()), default: read.voice } satisfies VoiceList);
  });

  /** `{ voice, text }` read aloud, to hear a voice before choosing it. Answers with the MP3. */
  routes.post("/voices/sample", async (req: Request, res: Response) => {
    const read = needSpeech();
    const body = object(req.body);
    const voice = checkVoice(body.voice) ?? read.voice;
    const text = required(body.text, LIMITS.voiceSample, "The sample");
    const audio = await asked(() => read.sample(voice, text));
    res.type("audio/mpeg").send(Buffer.from(audio));
  });

  return routes;
}
