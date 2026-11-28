// Reading aloud, as the server starts: the folder of kept audio, swept of files nothing refers to,
// and Azure to read replies when the server has a key for it. Without a key nothing is read.
import type { DatabaseSync } from "node:sqlite";
import { config } from "../config.ts";
import { createFileStore, type FileStore } from "../files.ts";
import { createAzureSpeech } from "./azure.ts";
import { azureVoice } from "./engine.ts";
import { loadSpeechKey } from "./key.ts";
import { createSpeech, knownSpeechFiles, SPEECH_DIR } from "./store.ts";

export interface SpeechFeature {
  files: FileStore;
  /** Reads replies aloud; null when the server has no Azure Speech key. */
  speech: ReturnType<typeof createSpeech> | null;
}

export function startSpeech(db: DatabaseSync): SpeechFeature {
  const files = createFileStore(SPEECH_DIR);
  const swept = files.sweep(knownSpeechFiles(db));
  if (swept > 0) console.log(`Deleted ${swept} audio file(s) nothing refers to any more`);

  const key = loadSpeechKey();
  const speech = key
    ? createSpeech({
        db,
        engine: azureVoice(createAzureSpeech({ key: key.key, region: config.speech.region })),
        files,
        voice: config.speech.voice,
      })
    : null;
  console.log(
    speech
      ? `Reading aloud: ${SPEECH_DIR}, ${config.speech.voice} on Azure ${config.speech.region} (key from ${key?.from === "credential" ? "the systemd credential" : "SPEECH_KEY"})`
      : "Reading aloud: off, no Azure Speech key",
  );
  return { files, speech };
}
