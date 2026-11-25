// The one place Valhalla 2 talks to the Claude API is this folder; this file holds the client.
//
// What goes out is built in ../prompt.ts: the companion's profile, the selected path through the
// chat exactly as it was stored, and the settings the companion has. Nothing is filtered or
// rewritten on the way out, and nothing is softened on the way back: a reply the API declines to
// give comes back as a reply that says so, with the category it names.
//
//   client.ts    the key, the client, the betas, and API failures as refusals the page can show
//   reply.ts     a chat reply, streamed
//   memory.ts    a run of the memory model
//   pictures.ts  a picture's prompt
//   tokens.ts    counting a chat, and each model's context window
import Anthropic from "@anthropic-ai/sdk";
import { StoreError } from "../errors.ts";
import { loadApiKey } from "../key.ts";

// The key from key.ts. Without one (development only) the SDK finds ANTHROPIC_AUTH_TOKEN or the
// profile left by `ant auth login` on its own. Either way it stays in this process.
const key = loadApiKey();
export const client = key ? new Anthropic({ apiKey: key.apiKey }) : new Anthropic();

/** Where the key came from, for the server's log. */
export const keySource = (): string =>
  key?.from === "credential"
    ? "the systemd credential"
    : key
      ? "ANTHROPIC_API_KEY"
      : "none set: an `ant auth login` profile is used, if there is one";

/**
 * Whether the server has an API key. False does not mean no credential in development — an
 * `ant auth login` profile works too, and only a request can tell.
 */
export const hasApiKey = (): boolean => key !== null || Boolean(process.env.ANTHROPIC_AUTH_TOKEN);

/** The beta that lets a request say what to do with thinking an edited history no longer matches. */
export const THINKING_BINDING_BETA = "thinking-binding-controls-2026-08-01";
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * How the model is asked to think. Thinking is always on in this generation and `effort` is the
 * one dial; there is no temperature on these models at all.
 *
 * The API binds every thinking block to the exact conversation before it. Editing or deleting a
 * message, or a history that drops its oldest turns, changes that conversation, and the API would
 * refuse the request. "drop_block" tells it to leave out the thinking that no longer matches
 * instead: the reply is written without that reasoning, and nothing is refused.
 */
export const thinking = {
  type: "adaptive",
  block_binding: { prefix_mismatch_behavior: "drop_block" },
} as const;

/** An API failure as something the page can show, keeping what the API actually said. */
export function asStoreError(err: unknown): StoreError {
  if (err instanceof Anthropic.AuthenticationError) {
    // Not 401: from this API that means "not signed in", and the page would send you to Heimdall.
    return new StoreError(
      502,
      "Claude refused the server's API key. Whoever runs this Valhalla 2 needs to check it.",
      "no-credential",
    );
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new StoreError(403, `Claude refused this request: ${err.message}`, "api");
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new StoreError(429, "Claude is rate-limiting this key. Wait a moment and send it again.", "api");
  }
  if (err instanceof Anthropic.BadRequestError) {
    // Worth showing word for word: it names the setting the API would not take.
    return new StoreError(400, `Claude would not accept the request: ${err.message}`, "api");
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new StoreError(503, "Claude can't be reached. Check the connection and try again.", "api");
  }
  if (err instanceof Anthropic.APIError) {
    return new StoreError(502, `Claude answered with an error: ${err.message}`, "api");
  }
  if (err instanceof Anthropic.AnthropicError) {
    // Not an APIError, so the SDK gave up before sending anything. In practice that means it
    // found no credential to use, which is worth saying plainly rather than as a 500.
    return hasApiKey()
      ? new StoreError(502, `Claude could not be called: ${err.message}`, "api")
      : new StoreError(503, "No Claude API key is set up on the server.", "no-credential");
  }
  if (err instanceof StoreError) return err;
  console.error(err);
  return new StoreError(500, "Something went wrong on the server");
}
