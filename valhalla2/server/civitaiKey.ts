import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The CivitAI API key, which makes pictures. Like the Claude key (key.ts), it is read here, in the
// server process, and never reaches the browser.
//
// On a server it is /etc/axis-suite/valhalla2-civitai.key (root-only, put there by hand), which
// systemd hands to the service as a credential (LoadCredential= in valhalla2.service).
// In development it is CIVITAI_API_KEY in data/secret.env, which git ignores.
//
// Unlike the Claude key it is optional: without it (or with an empty file) Valhalla 2 works as
// before, and simply offers no pictures.

const CREDENTIAL = "civitai-api-key";

export interface CivitaiKey {
  token: string;
  from: "credential" | "environment";
}

/** The key to make pictures with, or null when there is none. */
export function loadCivitaiKey(env: NodeJS.ProcessEnv = process.env): CivitaiKey | null {
  if (env.CREDENTIALS_DIRECTORY) {
    const file = join(env.CREDENTIALS_DIRECTORY, CREDENTIAL);
    if (existsSync(file)) {
      const token = readFileSync(file, "utf8").trim();
      if (token) return { token, from: "credential" };
    }
  }
  const fromEnv = env.CIVITAI_API_KEY?.trim();
  return fromEnv ? { token: fromEnv, from: "environment" } : null;
}
