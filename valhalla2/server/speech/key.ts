import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The Azure Speech key, which reads replies aloud. Like the Claude key (../key.ts), it is read
// here, in the server process, and never reaches the browser.
//
// On a server it is /etc/axis-suite/valhalla2-speech.key (root-only, put there by hand), which
// systemd hands to the service as a credential (LoadCredential= in valhalla2.service).
// In development it is SPEECH_KEY in data/secret.env, which git ignores.
//
// Like the CivitAI key it is optional: without it (or with an empty file) Valhalla 2 works as
// before, and simply reads nothing aloud.

const CREDENTIAL = "speech-api-key";

export interface SpeechKey {
  key: string;
  from: "credential" | "environment";
}

/** The key to read replies aloud with, or null when there is none. */
export function loadSpeechKey(env: NodeJS.ProcessEnv = process.env): SpeechKey | null {
  if (env.CREDENTIALS_DIRECTORY) {
    const file = join(env.CREDENTIALS_DIRECTORY, CREDENTIAL);
    if (existsSync(file)) {
      const key = readFileSync(file, "utf8").trim();
      if (key) return { key, from: "credential" };
    }
  }
  const fromEnv = env.SPEECH_KEY?.trim();
  return fromEnv ? { key: fromEnv, from: "environment" } : null;
}
