import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The Claude API key. It is read here, in the server process, and never reaches the browser.
//
// On a server it is /etc/axis-suite/valhalla-anthropic.key (root-only, put there by hand), which
// systemd hands to the service as a credential (LoadCredential= in valhalla.service).
// In development it is ANTHROPIC_API_KEY in data/secret.env, which git ignores. Never dev.env:
// that file is committed, and the repository is public.

/** The key is missing or empty where it has to be. */
export class KeyError extends Error {}

const CREDENTIAL = "anthropic-api-key";

export interface ApiKey {
  apiKey: string;
  from: "credential" | "environment";
}

/**
 * The key to call Claude with, or null in development when there is none — the SDK then looks for
 * a profile from `ant auth login` on its own. On a server a missing key is an error.
 */
export function loadApiKey(env: NodeJS.ProcessEnv = process.env): ApiKey | null {
  if (env.CREDENTIALS_DIRECTORY) {
    const file = join(env.CREDENTIALS_DIRECTORY, CREDENTIAL);
    if (!existsSync(file))
      throw new KeyError(`No Claude API key at ${file}: check LoadCredential= in valhalla.service`);
    const apiKey = readFileSync(file, "utf8").trim();
    if (!apiKey)
      throw new KeyError(`${file} is empty: put the Claude API key in /etc/axis-suite/valhalla-anthropic.key`);
    return { apiKey, from: "credential" };
  }
  const fromEnv = env.ANTHROPIC_API_KEY?.trim();
  if (fromEnv) return { apiKey: fromEnv, from: "environment" };
  if (env.NODE_ENV === "production") {
    throw new KeyError(
      `No Claude API key: the service must be started with LoadCredential=${CREDENTIAL}:/etc/axis-suite/valhalla-anthropic.key`,
    );
  }
  return null;
}
