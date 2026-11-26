// The one place Valhalla 2 talks to the xAI API is this folder; this file holds the client.
//
// Only chat replies can come from Grok. The memory model, scene reading and picture prompts stay
// on Claude (../claude/). xAI speaks OpenAI's Responses API, so the client is the `openai` SDK
// pointed at api.x.ai.
//
//   key.ts      the key, from the systemd credential or XAI_API_KEY
//   client.ts   the client, and API failures as refusals the page can show
//   reply.ts    a chat reply, streamed
//   tokens.ts   each model's context window
import OpenAI from "openai";
import { StoreError } from "../errors.ts";
import { loadXaiKey } from "./key.ts";

const key = loadXaiKey();

/** The client, or null when the server has no xAI key. */
export const grok: OpenAI | null = key ? new OpenAI({ apiKey: key.apiKey, baseURL: "https://api.x.ai/v1" }) : null;

/** Where the key came from, for the server's log. */
export const grokKeySource = (): string =>
  key?.from === "credential" ? "the systemd credential" : key ? "XAI_API_KEY" : "none set: no Grok models";

/** Whether the server can call Grok. */
export const hasGrokKey = (): boolean => grok !== null;

/** The client, or the refusal the page shows when there is no key. */
export function grokClient(): OpenAI {
  if (!grok) throw new StoreError(503, "No Grok API key is set up on the server.", "no-credential");
  return grok;
}

/** An xAI API failure as something the page can show, or null when `err` is not one. */
export function grokError(err: unknown): StoreError | null {
  if (err instanceof OpenAI.AuthenticationError) {
    // Not 401: from this API that means "not signed in", and the page would send you to Heimdall.
    return new StoreError(
      502,
      "Grok refused the server's API key. Whoever runs this Valhalla 2 needs to check it.",
      "no-credential",
    );
  }
  if (err instanceof OpenAI.PermissionDeniedError) {
    return new StoreError(403, `Grok refused this request: ${err.message}`, "api");
  }
  if (err instanceof OpenAI.RateLimitError) {
    return new StoreError(429, "Grok is rate-limiting this key. Wait a moment and send it again.", "api");
  }
  if (err instanceof OpenAI.BadRequestError) {
    // Worth showing word for word: it names the setting the API would not take.
    return new StoreError(400, `Grok would not accept the request: ${err.message}`, "api");
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return new StoreError(503, "Grok can't be reached. Check the connection and try again.", "api");
  }
  if (err instanceof OpenAI.APIError) {
    return new StoreError(502, `Grok answered with an error: ${err.message}`, "api");
  }
  if (err instanceof OpenAI.OpenAIError) {
    return new StoreError(502, `Grok could not be called: ${err.message}`, "api");
  }
  return null;
}
