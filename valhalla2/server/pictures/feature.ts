// Pictures, as the server starts: their folder, swept of files nothing refers to, and the engines
// that make them: CivitAI when the server has a key for it, Grok Imagine when it has an xAI key,
// OpenAI when it has an OpenAI key. Without any the files stay viewable and nothing new is made.
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { PictureEngineId } from "../../shared/protocol.ts";
import { STATE_DIR } from "../db.ts";
import { createFileStore, type FileStore } from "../files.ts";
import { loadXaiKey } from "../grok/key.ts";
import { loadOpenAiKey } from "../openai/key.ts";
import { createCheckpointLookup } from "./checkpoint.ts";
import { civitaiEngine, createCivitai, type Civitai } from "./civitai.ts";
import type { PictureEngine } from "./engine.ts";
import { createGrokImagine, grokImagineEngine } from "./grok.ts";
import { loadCivitaiKey } from "./key.ts";
import { createOpenAiImages, openAiImagesEngine } from "./openai.ts";
import { createPainter } from "./painter.ts";
import { knownFiles } from "./store.ts";

/** Next to the database, as an absolute path, which sendFile needs. */
export const PICTURES_DIR = resolve(STATE_DIR, "pictures");

export interface PicturesFeature {
  files: FileStore;
  /** Makes pictures in the background; null when the server has no CivitAI, xAI or OpenAI key. */
  painter: ReturnType<typeof createPainter> | null;
  /** Looks up a checkpoint and asks CivitAI what a picture on it costs; null without a CivitAI key. */
  checkpoints: { lookUp: ReturnType<typeof createCheckpointLookup>; estimate: Civitai["estimate"] } | null;
}

export function startPictures(db: DatabaseSync): PicturesFeature {
  const files = createFileStore(PICTURES_DIR);
  const swept = files.sweep(knownFiles(db));
  if (swept > 0) console.log(`Deleted ${swept} picture file(s) nothing refers to any more`);

  const civitaiKey = loadCivitaiKey();
  const xaiKey = loadXaiKey();
  const openaiKey = loadOpenAiKey();
  const engines: Partial<Record<PictureEngineId, PictureEngine>> = {};
  const civitai = civitaiKey ? createCivitai({ token: civitaiKey.token }) : null;
  if (civitai) engines.civitai = civitaiEngine(civitai);
  if (xaiKey) engines.grok = grokImagineEngine(createGrokImagine({ apiKey: xaiKey.apiKey }));
  if (openaiKey) engines.openai = openAiImagesEngine(createOpenAiImages({ apiKey: openaiKey.apiKey }));

  const painter = Object.keys(engines).length > 0 ? createPainter({ db, engines, files }) : null;
  const said = [
    civitaiKey
      ? `CivitAI (key from ${civitaiKey.from === "credential" ? "the systemd credential" : "CIVITAI_API_KEY"})`
      : "",
    xaiKey ? `Grok Imagine (key from ${xaiKey.from === "credential" ? "the systemd credential" : "XAI_API_KEY"})` : "",
    openaiKey
      ? `OpenAI (key from ${openaiKey.from === "credential" ? "the systemd credential" : "OPENAI_API_KEY"})`
      : "",
  ].filter(Boolean);
  console.log(
    painter ? `Pictures: ${PICTURES_DIR}, made by ${said.join(", ")}` : "Pictures: off, no CivitAI, xAI or OpenAI key",
  );
  if (painter) {
    const resumed = painter.resume();
    if (resumed > 0) console.log(`Picking up ${resumed} picture(s) the last stop cut short`);
  }
  const checkpoints = civitai ? { lookUp: createCheckpointLookup(), estimate: civitai.estimate } : null;
  return { files, painter, checkpoints };
}
