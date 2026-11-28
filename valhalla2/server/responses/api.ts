// The APIs that speak OpenAI's Responses API: xAI's (Grok, ../grok/) and OpenAI's own (GPT,
// ../openai/). Everything they share is in this folder, written once:
//
//   api.ts       what tells one such API from another, and its failures as refusals
//   key.ts       a key, from a systemd credential or an environment variable
//   reply.ts     a chat reply, streamed
//   memory.ts    a run of the memory model, with the memory tool as a function
//   pictures.ts  a picture's prompt
//   reading.ts   a structured reading: a scene, or how a reply is said aloud
//
// Each function takes the API it is for. Nothing here picks one: chat/write.ts does, by the
// companion.
import OpenAI from "openai";
import type { ReasoningEffort } from "openai/resources/shared";
import type { Effort } from "../../shared/protocol.ts";
import { StoreError } from "../errors.ts";

export interface ResponsesApi {
  provider: "xai" | "openai";
  /** The models' name, in what the page is told of a reply or a reading: "Grok", "GPT". */
  name: string;
  /** Who runs the API, in what the page is told of a key or a failure: "Grok", "OpenAI". */
  vendor: string;
  /** The client, or the refusal the page shows when the server has no key. */
  client(): OpenAI;
  /** Each of Valhalla 2's efforts as this API takes it, sent as `reasoning.effort`. */
  effort: Readonly<Record<Effort, ReasoningEffort>>;
  /** Whether a companion's temperature goes out. Only Grok's takes one. */
  temperature: boolean;
}

/** The client for an API, or null when there is no key. */
export function clientFor(key: { apiKey: string } | null, baseURL?: string): OpenAI | null {
  return key ? new OpenAI({ apiKey: key.apiKey, ...(baseURL ? { baseURL } : {}) }) : null;
}

/** The client, or the refusal the page shows when there is no key. */
export function needClient(client: OpenAI | null, vendor: string): OpenAI {
  if (!client) throw new StoreError(503, `No ${vendor} API key is set up on the server.`, "no-credential");
  return client;
}

/** A failure of a Responses API as something the page can show, or null when `err` is not one. */
export function apiErrorOf(vendor: string, err: unknown): StoreError | null {
  if (err instanceof OpenAI.AuthenticationError) {
    // Not 401: from this API that means "not signed in", and the page would send you to Heimdall.
    return new StoreError(
      502,
      `${vendor} refused the server's API key. Whoever runs this Valhalla 2 needs to check it.`,
      "no-credential",
    );
  }
  if (err instanceof OpenAI.PermissionDeniedError) {
    return new StoreError(403, `${vendor} refused this request: ${err.message}`, "api");
  }
  if (err instanceof OpenAI.RateLimitError) {
    return new StoreError(429, `${vendor} is rate-limiting this key. Wait a moment and send it again.`, "api");
  }
  if (err instanceof OpenAI.BadRequestError) {
    // Worth showing word for word: it names the setting the API would not take.
    return new StoreError(400, `${vendor} would not accept the request: ${err.message}`, "api");
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return new StoreError(503, `${vendor} can't be reached. Check the connection and try again.`, "api");
  }
  if (err instanceof OpenAI.APIError) {
    return new StoreError(502, `${vendor} answered with an error: ${err.message}`, "api");
  }
  if (err instanceof OpenAI.OpenAIError) {
    return new StoreError(502, `${vendor} could not be called: ${err.message}`, "api");
  }
  return null;
}
