// Replies read aloud. Asking (POST) reads the reply if it isn't kept yet and says where the audio
// is; the page then plays that file (GET), which an <audio> element can fetch by itself. A reply is
// read in its companion's voice, or the server's when it names none, and with the feeling of each
// line as the scene worked it out, unless the companion reads plainly; at the companion's speed,
// pitch and speaking style either way. The voices to choose from, and a short sample of one, are
// here too.
import { Router, type Request, type Response } from "express";
import {
  FEELINGS,
  LIMITS,
  type ApiError,
  type Companion,
  type Feeling,
  type Message,
  type SpeechReply,
  type VoiceList,
} from "../../shared/protocol.ts";
import {
  id as checkId,
  messageId,
  object,
  oneOf,
  required,
  voice as checkVoice,
  voiceTuning as checkTuning,
} from "../check.ts";
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

  /**
   * How each line of the reply at the end of `path` is said, from its scene. When the scene can't
   * be read (Claude is unreachable, say), the reply is read plainly rather than not at all.
   */
  async function feelingOf(companion: Companion, path: readonly Message[]) {
    const at = path.at(-1)!;
    try {
      return (await s.scenes.of(at.id, s.moment(companion, path))).sheet.lines;
    } catch (err) {
      console.warn(`Reading message ${at.id} plainly: its scene couldn't be read:`, (err as Error).message);
      return null;
    }
  }

  /** Azure Speech, or a refusal when the server has no key for it. */
  const needSpeech = () => s.speech ?? invalid("This Valhalla 2 has no Azure Speech key, so it can't read aloud");

  routes.post("/chats/:id/messages/:messageId/speech", async (req: Request, res: Response) => {
    const read = needSpeech();
    const my = s.ownedBy(req);
    const id = checkId(req.params.id);
    const chat = my.chats.get(id);
    const tree = my.chats.tree(id);
    const message = tree.get(messageId(req.params.messageId));
    const companion = my.companions.get(chat.companionId);
    // Without memory there is no scene: the reply is read as it is written.
    const feeling = companion.memory && companion.voiceFeeling;
    const lines = feeling ? await feelingOf(companion, tree.pathTo(message.id)) : null;
    const { file } = await asked(() => read.of(message, companion.voice ?? undefined, lines, companion.voiceTuning));
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

  /**
   * `{ voice, text, feeling?, tuning? }` read aloud, to hear a voice (at a speed, pitch and style)
   * before choosing it. Answers with the MP3.
   */
  routes.post("/voices/sample", async (req: Request, res: Response) => {
    const read = needSpeech();
    const body = object(req.body);
    const voice = checkVoice(body.voice) ?? read.voice;
    const text = required(body.text, LIMITS.voiceSample, "The sample");
    const feeling =
      body.feeling === undefined || body.feeling === null
        ? null
        : oneOf<Feeling>(body.feeling, FEELINGS, "The feeling");
    const tuning = checkTuning(body.tuning);
    const audio = await asked(() => read.sample(voice, text, feeling, tuning));
    res.type("audio/mpeg").send(Buffer.from(audio));
  });

  return routes;
}
