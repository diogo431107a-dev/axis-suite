// The OpenAI API key, which lets a companion answer on GPT. On a server it is
// /etc/axis-suite/valhalla2-openai.key, handed over by systemd as the credential `openai-api-key`;
// in development OPENAI_API_KEY in data/secret.env. Optional: without it there are no GPT models.
// How it is read is in ../responses/key.ts.
import { loadKey, type ApiKey } from "../responses/key.ts";

/** The key to call OpenAI with, or null when there is none. */
export const loadOpenAiKey = (env: NodeJS.ProcessEnv = process.env): ApiKey | null =>
  loadKey("openai-api-key", "OPENAI_API_KEY", env);
