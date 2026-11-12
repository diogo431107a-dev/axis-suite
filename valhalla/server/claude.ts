// The one place Valhalla talks to the Claude API.
//
// What goes out is the system prompt built from your character and persona, every turn of the
// conversation exactly as it was stored, and the settings you chose. Nothing is added, removed,
// filtered or rewritten on the way out, and nothing is softened on the way back: a reply the API
// declines to give comes back as a turn that says so, with the category it names.
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import type { ContentBlock, Settings, StreamEvent, Turn } from "../shared/protocol.ts";
import { StoreError } from "./errors.ts";
import type { SystemBlock } from "./prompt.ts";

// No arguments: the SDK finds ANTHROPIC_API_KEY, or ANTHROPIC_AUTH_TOKEN, or the profile left by
// `ant auth login`. The key is read here, in the server process, and never reaches the browser.
const client = new Anthropic();

/**
 * Whether an API key is set in the environment. False does not mean no credential — an
 * `ant auth login` profile works too, and only a request can tell. The page says as much.
 */
export const hasApiKeyInEnvironment = (): boolean =>
  Boolean(process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN);

/** Turns stored turns into what the Messages API expects. The content blocks go back untouched. */
const asMessages = (turns: Turn[]): Anthropic.Beta.BetaMessageParam[] =>
  turns.map((turn) => ({
    role: turn.role,
    // Stored verbatim when the reply arrived, and sent back verbatim: thinking blocks are only
    // valid in the conversation and on the model that produced them.
    content: turn.content as unknown as Anthropic.Beta.BetaContentBlockParam[],
  }));

export function requestFor(system: SystemBlock[], turns: Turn[], settings: Settings) {
  const request: Anthropic.Beta.MessageCreateParamsStreaming = {
    model: settings.model,
    max_tokens: settings.maxTokens,
    // Thinking is always on in this generation of models and cannot be configured further;
    // `effort` is the one dial. There is no temperature on these models at all.
    thinking: { type: "adaptive" },
    output_config: { effort: settings.effort },
    system,
    messages: asMessages(turns),
    // The explicit breakpoint in `system` holds the character and persona; this one follows the
    // conversation as it grows, so each turn re-reads everything said so far instead of paying
    // for it again.
    cache_control: { type: "ephemeral", ttl: settings.cacheTtl },
    stream: true,
  };
  if (settings.stopSequences.length > 0) request.stop_sequences = settings.stopSequences;
  if (settings.fallbacks) {
    // On a policy decline the API re-runs this same request on a fallback model, inside the same
    // call, chosen by category. Valhalla adds no filter either way; this only decides whether a
    // declined turn gets a second chance before it comes back to you.
    request.betas = ["server-side-fallback-2026-07-01"];
    request.fallbacks = "default";
  }
  return request;
}

/** The model that answered after an earlier one declined, if that happened. */
function servedByFallback(content: Anthropic.Beta.BetaContentBlock[]): string | null {
  const switched = content.filter((block) => block.type === "fallback");
  return switched.at(-1)?.to.model ?? null;
}

/** Builds the turn to store from a finished reply. */
export function turnOf(message: Anthropic.Beta.BetaMessage): Turn {
  return {
    id: randomUUID(),
    at: new Date().toISOString(),
    role: "assistant",
    content: message.content as unknown as ContentBlock[],
    model: message.model,
    stopReason: message.stop_reason,
    stopDetails: message.stop_details
      ? { category: message.stop_details.category, explanation: message.stop_details.explanation }
      : null,
    usage: {
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
      cache_read_input_tokens: message.usage.cache_read_input_tokens,
      cache_creation_input_tokens: message.usage.cache_creation_input_tokens,
    },
    servedBy: servedByFallback(message.content),
  };
}

/** What the page should be told about one event from the API, or nothing when it needs no word. */
export function eventOf(event: Anthropic.Beta.BetaRawMessageStreamEvent): StreamEvent | null {
  if (event.type === "content_block_start" && event.content_block.type === "thinking") {
    // Thinking text is not returned by default, so this only says that it started.
    return { type: "thinking" };
  }
  if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
    return { type: "delta", text: event.delta.text };
  }
  return null;
}

/**
 * Asks for the next reply and reports it as it is written. Resolves with the turn to store —
 * including a turn whose `stopReason` is "refusal", which is an answer, not a failure.
 */
export async function streamReply(
  system: SystemBlock[],
  turns: Turn[],
  settings: Settings,
  onEvent: (event: StreamEvent) => void,
): Promise<Turn> {
  const stream = client.beta.messages.stream(requestFor(system, turns, settings));
  for await (const event of stream) {
    const told = eventOf(event);
    if (told) onEvent(told);
  }
  return turnOf(await stream.finalMessage());
}

/**
 * Counting needs at least one message — a conversation nobody has spoken in yet is refused with a
 * 400. So an empty one is counted with a single full stop standing in for your first message,
 * which answers the question actually being asked there: how large is this character and persona?
 * It costs a token or two of accuracy and nothing else.
 */
export const messagesToCount = (turns: Turn[]): Anthropic.Beta.BetaMessageParam[] =>
  turns.length > 0 ? asMessages(turns) : [{ role: "user", content: "." }];

/** How many input tokens this conversation would send as it stands. */
export async function countTokens(system: SystemBlock[], turns: Turn[], settings: Settings): Promise<number> {
  const counted = await client.beta.messages.countTokens({
    model: settings.model,
    system,
    messages: messagesToCount(turns),
  });
  return counted.input_tokens;
}

// What each model's context window is, asked once per model rather than written down here, so it
// stays right when a model changes.
const windows = new Map<string, number | null>();

export async function contextWindow(model: string): Promise<number | null> {
  const known = windows.get(model);
  if (known !== undefined) return known;
  try {
    const info = await client.models.retrieve(model);
    windows.set(model, info.max_input_tokens);
    return info.max_input_tokens;
  } catch {
    // An unknown or renamed model id: the page simply shows no window. Not worth refusing over.
    windows.set(model, null);
    return null;
  }
}

/** An API failure as something the page can show, keeping what the API actually said. */
export function asStoreError(err: unknown): StoreError {
  if (err instanceof Anthropic.AuthenticationError) {
    return new StoreError(
      401,
      "Claude refused the credential. Check ANTHROPIC_API_KEY, or sign in again.",
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
    return hasApiKeyInEnvironment()
      ? new StoreError(502, `Claude could not be called: ${err.message}`, "api")
      : new StoreError(
          401,
          "No Claude credential. Put ANTHROPIC_API_KEY in dev.env, or sign in with `ant auth login`.",
          "no-credential",
        );
  }
  if (err instanceof StoreError) return err;
  console.error(err);
  return new StoreError(500, "Something went wrong on the server");
}
