// Pictures, as the server starts: their folder, swept of files nothing refers to, and CivitAI to
// make them when the server has a key for it. Without a key the files stay viewable and nothing
// new is made.
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { STATE_DIR } from "../db.ts";
import { createFileStore, type FileStore } from "../files.ts";
import { createCivitai } from "./civitai.ts";
import { loadCivitaiKey } from "./key.ts";
import { createPainter } from "./painter.ts";
import { knownFiles } from "./store.ts";

/** Next to the database, as an absolute path, which sendFile needs. */
export const PICTURES_DIR = resolve(STATE_DIR, "pictures");

export interface PicturesFeature {
  files: FileStore;
  /** Makes pictures in the background; null when the server has no CivitAI key. */
  painter: ReturnType<typeof createPainter> | null;
}

export function startPictures(db: DatabaseSync): PicturesFeature {
  const files = createFileStore(PICTURES_DIR);
  const swept = files.sweep(knownFiles(db));
  if (swept > 0) console.log(`Deleted ${swept} picture file(s) nothing refers to any more`);

  const key = loadCivitaiKey();
  const painter = key ? createPainter({ db, civitai: createCivitai({ token: key.token }), files }) : null;
  console.log(
    painter
      ? `Pictures: ${PICTURES_DIR}, made by CivitAI (key from ${key?.from === "credential" ? "the systemd credential" : "CIVITAI_API_KEY"})`
      : "Pictures: off, no CivitAI key",
  );
  if (painter) {
    const resumed = painter.resume();
    if (resumed > 0) console.log(`Picking up ${resumed} picture(s) the last stop cut short`);
  }
  return { files, painter };
}
