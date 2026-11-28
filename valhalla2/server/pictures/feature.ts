// Pictures, as the server starts: their folder, swept of files nothing refers to, and the engines
// that make them: CivitAI when the server has a key for it, Grok Imagine when it has an xAI key.
// Without either the files stay viewable and nothing new is made.
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { PictureEngineId } from "../../shared/protocol.ts";
import { STATE_DIR } from "../db.ts";
import { createFileStore, type FileStore } from "../files.ts";
import { loadXaiKey } from "../grok/key.ts";
import { civitaiEngine, createCivitai } from "./civitai.ts";
import type { PictureEngine } from "./engine.ts";
import { createGrokImagine, grokImagineEngine } from "./grok.ts";
import { loadCivitaiKey } from "./key.ts";
import { createPainter } from "./painter.ts";
import { knownFiles } from "./store.ts";

/** Next to the database, as an absolute path, which sendFile needs. */
export const PICTURES_DIR = resolve(STATE_DIR, "pictures");

export interface PicturesFeature {
  files: FileStore;
  /** Makes pictures in the background; null when the server has neither a CivitAI nor an xAI key. */
  painter: ReturnType<typeof createPainter> | null;
}

export function startPictures(db: DatabaseSync): PicturesFeature {
  const files = createFileStore(PICTURES_DIR);
  const swept = files.sweep(knownFiles(db));
  if (swept > 0) console.log(`Deleted ${swept} picture file(s) nothing refers to any more`);

  const civitaiKey = loadCivitaiKey();
  const xaiKey = loadXaiKey();
  const engines: Partial<Record<PictureEngineId, PictureEngine>> = {};
  if (civitaiKey) engines.civitai = civitaiEngine(createCivitai({ token: civitaiKey.token }));
  if (xaiKey) engines.grok = grokImagineEngine(createGrokImagine({ apiKey: xaiKey.apiKey }));

  const painter = Object.keys(engines).length > 0 ? createPainter({ db, engines, files }) : null;
  const said = [
    civitaiKey
      ? `CivitAI (key from ${civitaiKey.from === "credential" ? "the systemd credential" : "CIVITAI_API_KEY"})`
      : "",
    xaiKey ? `Grok Imagine (key from ${xaiKey.from === "credential" ? "the systemd credential" : "XAI_API_KEY"})` : "",
  ].filter(Boolean);
  console.log(
    painter
      ? `Pictures: ${PICTURES_DIR}, made by ${said.join(" and ")}`
      : "Pictures: off, no CivitAI key and no xAI key",
  );
  if (painter) {
    const resumed = painter.resume();
    if (resumed > 0) console.log(`Picking up ${resumed} picture(s) the last stop cut short`);
  }
  return { files, painter };
}
