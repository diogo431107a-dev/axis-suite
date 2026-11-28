// The xAI API key, which lets a companion answer on Grok (and makes Grok's pictures and voices).
// On a server it is /etc/axis-suite/valhalla2-xai.key, handed over by systemd as the credential
// `xai-api-key`; in development XAI_API_KEY in data/secret.env. Optional: without it there are no
// Grok models. How it is read is in ../responses/key.ts.
import { loadKey, type ApiKey } from "../responses/key.ts";

export type XaiKey = ApiKey;

/** The key to call Grok with, or null when there is none. */
export const loadXaiKey = (env: NodeJS.ProcessEnv = process.env): XaiKey | null =>
  loadKey("xai-api-key", "XAI_API_KEY", env);
