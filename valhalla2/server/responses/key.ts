import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The key for a Responses API (xAI's, OpenAI's). Like the Claude key (../key.ts), it is read here,
// in the server process, and never reaches the browser.
//
// On a server it is a root-only file in /etc/axis-suite, put there by hand, which systemd hands to
// the service as a credential (LoadCredential= in valhalla2.service). In development it is an
// environment variable in data/secret.env, which git ignores.
//
// Unlike the Claude key it is optional: without it (or with an empty file) Valhalla 2 works as
// before, and simply offers none of that API's models.

export interface ApiKey {
  apiKey: string;
  from: "credential" | "environment";
}

/** The key named `credential` (systemd) or `variable` (development), or null when there is none. */
export function loadKey(credential: string, variable: string, env: NodeJS.ProcessEnv = process.env): ApiKey | null {
  if (env.CREDENTIALS_DIRECTORY) {
    const file = join(env.CREDENTIALS_DIRECTORY, credential);
    if (existsSync(file)) {
      const apiKey = readFileSync(file, "utf8").trim();
      if (apiKey) return { apiKey, from: "credential" };
    }
  }
  const fromEnv = env[variable]?.trim();
  return fromEnv ? { apiKey: fromEnv, from: "environment" } : null;
}

/** Where a key came from, for the server's log. */
export const keySource = (key: ApiKey | null, variable: string, none: string): string =>
  key?.from === "credential" ? "the systemd credential" : key ? variable : none;
