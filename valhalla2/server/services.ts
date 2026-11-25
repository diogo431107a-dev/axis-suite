// Everything the routes use, made once as the server starts. Each router (routes/) is handed this
// and nothing else, so a new area of the API is a new router plus, at most, a line here.
//
// An optional feature (pictures, reading aloud) starts itself in its own feature.ts and is null
// here when the server has no key for it.
import type { Request } from "express";
import { heimdallAuth } from "@axis-suite/heimdall-client/server";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { startDailyBackups } from "./backup.ts";
import { createBusy } from "./busy.ts";
import { createChats } from "./chat/chats.ts";
import { id as checkId } from "./check.ts";
import { createCompanions } from "./companions.ts";
import { config } from "./config.ts";
import { STATE_DIR } from "./db.ts";
import { createLikes } from "./likes.ts";
import { createScheduler } from "./memory/scheduler.ts";
import { createMemoryService } from "./memory/service.ts";
import { createMemory } from "./memory/store.ts";
import { runMemoryModel } from "./claude/memory.ts";
import { startPictures } from "./pictures/feature.ts";
import { createPictures } from "./pictures/store.ts";
import { createPins, pinsOf } from "./pins.ts";
import { readScene } from "./claude/scene.ts";
import type { Remembered } from "./scene/context.ts";
import { createScenes, momentRequest } from "./scene/sheet.ts";
import { startSpeech } from "./speech/feature.ts";
import type { Companion, Message } from "../shared/protocol.ts";
import { closeCutShortRuns, removeGoneUsers } from "./startup.ts";

export function createServices(db: DatabaseSync) {
  closeCutShortRuns(db);

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

  const backupDir = join(STATE_DIR, "backups");
  const stopBackups = startDailyBackups(db, backupDir, config.backupsKept);

  removeGoneUsers(db);

  const pictures = startPictures(db);
  const speech = startSpeech(db);

  const auth = heimdallAuth();

  /** The signed-in person's own companions and chats. Made per request: they hold no state. */
  function ownedBy(req: Request) {
    const { username } = auth.user(req);
    const companions = createCompanions(db, username, config.defaults);
    const chats = createChats(db, username, companions, config.swipeAsk);
    return {
      username,
      companions,
      chats,
      pictures: createPictures(db, username),
      pins: createPins(db, username, chats),
      likes: createLikes(db, chats),
    };
  }

  /** What a companion remembers, as the scene reading takes it. */
  const remembered = (companionId: string): Remembered => ({
    files: memory.files(companionId),
    pins: pinsOf(db, companionId),
  });

  /** What is asked about the moment at the end of `path`. */
  const moment = (companion: Companion, path: readonly Message[]) =>
    momentRequest(companion, remembered(companion.id), path, config.scene.tokens);

  /** The signed-in person's companion named by `:id` in the path. */
  const companionOf = (req: Request) => ownedBy(req).companions.get(checkId(req.params.id));

  return {
    db,
    auth,
    /** One reply at a time per chat. */
    busy: createBusy(),
    memory,
    memoryService,
    scheduler,
    backupDir,
    pictureFiles: pictures.files,
    painter: pictures.painter,
    speechFiles: speech.files,
    speech: speech.speech,
    /** Moments worked out, kept. */
    scenes: createScenes({ db, read: readScene, model: config.scene.model }),
    remembered,
    moment,
    ownedBy,
    companionOf,
    /** Stops the timers, so the process can end. */
    stop() {
      scheduler.stop();
      stopBackups();
    },
  };
}

export type Services = ReturnType<typeof createServices>;
