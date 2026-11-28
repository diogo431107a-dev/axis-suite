// Pictures of a companion: a profile picture from its page, a chat picture from a message. A model
// writes the prompt, you look it over, and CivitAI makes the picture in the background.
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import {
  hasScenes,
  LIMITS,
  ORIENTATIONS,
  PICTURE_KINDS,
  PICTURE_SIZES,
  type ApiError,
  type Companion,
  type Orientation,
  type PictureDraftReply,
  type PictureKind,
} from "../../shared/protocol.ts";
import { writePictureFor } from "../chat/write.ts";
import { id as checkId, messageId, object, oneOf, required, text } from "../check.ts";
import { config } from "../config.ts";
import { invalid } from "../errors.ts";
import { sendStored } from "../http/sendStored.ts";
import { PICTURE_DEFAULTS, randomSeed } from "../pictures/civitai.ts";
import { backgroundOf, plainPictureRequest, sceneRequest, type Scene } from "../scene/context.ts";
import type { Services } from "../services.ts";

export function pictureRoutes(s: Services): Router {
  const routes = Router();

  /** CivitAI, or a refusal when the server has no key for it. */
  function needPictures() {
    return s.painter ?? invalid("This Valhalla 2 has no CivitAI key, so it can't make pictures");
  }

  /** The chat and message a chat picture is of, checked against the companion. */
  function sceneOf(req: Request, companion: Companion, body: Record<string, unknown>) {
    const my = s.ownedBy(req);
    const chat = my.chats.get(checkId(body.chatId));
    if (chat.companionId !== companion.id) invalid("That chat is with another companion");
    const tree = my.chats.tree(chat.id);
    const at = messageId(body.messageId);
    tree.get(at);
    return { chat, messageId: at, path: tree.pathTo(at) };
  }

  routes.post("/companions/:id/pictures/prompt", async (req: Request, res: Response) => {
    needPictures();
    const companion = s.companionOf(req);
    const body = object(req.body);
    const kind = oneOf<PictureKind>(body.kind, PICTURE_KINDS, "The kind of picture");
    const hint = body.hint === undefined ? "" : text(body.hint, LIMITS.pictureHint, "The note");
    const from = kind === "chat" ? sceneOf(req, companion, body) : null;
    const scene: Scene = from ? { kind: "chat", path: from.path } : { kind: "profile" };
    // With scenes, a chat picture is drawn from the moment worked out: read once, kept, and yours to
    // correct. Without memory, from the message itself and the profile.
    const scenes = hasScenes(companion);
    const read = from && scenes ? await s.scenes.of(from.messageId, s.moment(companion, from.path)) : null;
    const request = scenes
      ? sceneRequest(
          companion,
          scene,
          hint,
          backgroundOf(companion, s.remembered(companion.id)),
          config.scene.tokens,
          read?.sheet,
        )
      : plainPictureRequest(companion, scene, hint);
    const draft = await writePictureFor(companion, request);
    res.json({ ...draft, scene: read } satisfies PictureDraftReply);
  });

  routes.post("/companions/:id/pictures", (req: Request, res: Response) => {
    const paint = needPictures();
    const companion = s.companionOf(req);
    const body = object(req.body);
    const kind = oneOf<PictureKind>(body.kind, PICTURE_KINDS, "The kind of picture");
    const from = kind === "chat" ? sceneOf(req, companion, body) : null;
    const orientation = oneOf<Orientation>(body.orientation, ORIENTATIONS, "The orientation");
    const picture = s.ownedBy(req).pictures.create({
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

  routes.get("/companions/:id/pictures", (req: Request, res: Response) => {
    const companion = s.companionOf(req);
    res.json(s.ownedBy(req).pictures.of(companion.id));
  });

  routes.get("/pictures/:id", (req: Request, res: Response) => {
    res.json(s.ownedBy(req).pictures.get(checkId(req.params.id)));
  });

  // The picture itself, from disk, to its owner only. It never changes: a new picture is a new id.
  routes.get("/pictures/:id/file", (req: Request, res: Response) => {
    const file = s.ownedBy(req).pictures.fileOf(checkId(req.params.id));
    if (!file) return void res.status(404).json({ error: "That picture isn't ready" } satisfies ApiError);
    sendStored(res, s.pictureFiles.path(file), "No such picture");
  });

  routes.delete("/pictures/:id", (req: Request, res: Response) => {
    const file = s.ownedBy(req).pictures.remove(checkId(req.params.id));
    if (file) s.pictureFiles.remove(file);
    res.status(204).end();
  });

  return routes;
}
