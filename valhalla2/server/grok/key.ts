import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The xAI API key, which lets a companion answer on Grok. Like the Claude key (../key.ts), it is
// read here, in the server process, and never reaches the browser.
//
// On a server it is /etc/axis-suite/valhalla2-xai.key (root-only, put there by hand), which
// systemd hands to the service as a credential (LoadCredential= in valhalla2.service).
// In development it is XAI_API_KEY in data/secret.env, which git ignores.
//
// Unlike the Claude key it is optional: without it (or with an empty file) Valhalla 2 works as
// before, and simply offers no Grok models.

const CREDENTIAL = "xai-api-key";

export interface XaiKey {
  apiKey: string;
  from: "credential" | "environment";
}

/** The key to call Grok with, or null when there is none. */
export function loadXaiKey(env: NodeJS.ProcessEnv = process.env): XaiKey | null {
  if (env.CREDENTIALS_DIRECTORY) {
    const file = join(env.CREDENTIALS_DIRECTORY, CREDENTIAL);
    if (existsSync(file)) {
      const apiKey = readFileSync(file, "utf8").trim();
      if (apiKey) return { apiKey, from: "credential" };
    }
  }
  const fromEnv = env.XAI_API_KEY?.trim();
  return fromEnv ? { apiKey: fromEnv, from: "environment" } : null;
}
