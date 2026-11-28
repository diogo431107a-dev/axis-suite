// Reading aloud, as the server starts: the folder of kept audio, swept of files nothing refers to,
// and the engines that read replies: Azure when the server has a Speech key for it, Grok's voices
// when it has an xAI key. Without either nothing is read.
import type { DatabaseSync } from "node:sqlite";
import { engineOfVoice, GROK_VOICE, type SpeechEngine } from "../../shared/protocol.ts";
import { config } from "../config.ts";
import { createFileStore, type FileStore } from "../files.ts";
import { loadXaiKey } from "../grok/key.ts";
import { createAzureSpeech } from "./azure.ts";
import { azureVoice, grokVoice, type VoiceEngine } from "./engine.ts";
import { createGrokSpeech } from "./grok.ts";
import { loadSpeechKey } from "./key.ts";
import { createSpeech, knownSpeechFiles, SPEECH_DIR } from "./store.ts";

export interface SpeechFeature {
  files: FileStore;
  /** Reads replies aloud; null when the server has neither an Azure Speech key nor an xAI key. */
  speech: ReturnType<typeof createSpeech> | null;
}

/** Each engine's own voice, for a server whose SPEECH_VOICE belongs to an engine it has no key for. */
const FALLBACK: Readonly<Record<SpeechEngine, string>> = {
  azure: "en-US-AvaMultilingualNeural",
  grok: `${GROK_VOICE}eve`,
};

export function startSpeech(db: DatabaseSync): SpeechFeature {
  const files = createFileStore(SPEECH_DIR);
  const swept = files.sweep(knownSpeechFiles(db));
  if (swept > 0) console.log(`Deleted ${swept} audio file(s) nothing refers to any more`);

  const azureKey = loadSpeechKey();
  const xaiKey = loadXaiKey();
  const engines: Partial<Record<SpeechEngine, VoiceEngine>> = {};
  if (azureKey) engines.azure = azureVoice(createAzureSpeech({ key: azureKey.key, region: config.speech.region }));
  if (xaiKey) engines.grok = grokVoice(createGrokSpeech({ apiKey: xaiKey.apiKey }));

  const on = Object.keys(engines) as SpeechEngine[];
  if (on.length === 0) {
    console.log("Reading aloud: off, no Azure Speech key and no xAI key");
    return { files, speech: null };
  }
  const voice = engines[engineOfVoice(config.speech.voice)] ? config.speech.voice : FALLBACK[on[0]!];
  const speech = createSpeech({ db, engines, files, voice });
  const said = [
    azureKey
      ? `Azure ${config.speech.region} (key from ${azureKey.from === "credential" ? "the systemd credential" : "SPEECH_KEY"})`
      : "",
    xaiKey ? `Grok (key from ${xaiKey.from === "credential" ? "the systemd credential" : "XAI_API_KEY"})` : "",
  ].filter(Boolean);
  console.log(`Reading aloud: ${SPEECH_DIR}, ${voice} by default, on ${said.join(" and ")}`);
  return { files, speech };
}
