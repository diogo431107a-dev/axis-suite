// The one place Valhalla 2 talks to the Claude API.
//
// What goes out is built in prompt.ts: the companion's profile, the selected path through the
// chat exactly as it was stored, and the settings the companion has. Nothing is filtered or
// rewritten on the way out, and nothing is softened on the way back: a reply the API declines to
// give comes back as a reply that says so, with the category it names.
import Anthropic from "@anthropic-ai/sdk";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import {
  blockText,
  hasFallback,
  type Attempt,
  type ContentBlock,
  type RefusalDetails,
  type ReplyDetails,
  type Settings,
  type StreamEvent,
  type TurnUsage,
} from "../shared/protocol.ts";
import { StoreError } from "./errors.ts";
import { loadApiKey } from "./key.ts";
import type { SystemBlock } from "./prompt.ts";

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

export function requestFor(
  system: SystemBlock[],
  messages: Anthropic.Beta.BetaMessageParam[],
  settings: Settings,
): Anthropic.Beta.MessageCreateParamsStreaming {
  const request: Anthropic.Beta.MessageCreateParamsStreaming = {
    model: settings.model,
    max_tokens: settings.maxTokens,
    thinking,
    output_config: { effort: settings.effort },
    messages,
    // The explicit breakpoint in `system` holds the profile; this one follows the chat as it
    // grows, so each turn re-reads everything said so far instead of paying for it again.
    cache_control: { type: "ephemeral", ttl: settings.cacheTtl },
    betas: [THINKING_BINDING_BETA],
    stream: true,
  };
  if (system.length > 0) request.system = system;
  if (settings.stopSequences.length > 0) request.stop_sequences = settings.stopSequences;
  if (settings.fallbacks) {
    // On a policy decline the API re-runs this same request on a fallback model, inside the same
    // call, chosen by category. Valhalla 2 adds no filter either way; this only decides whether a
    // declined turn gets a second chance before it comes back to you.
    request.betas = [THINKING_BINDING_BETA, FALLBACK_BETA];
    request.fallbacks = "default";
  }
  return request;
}

const usageOf = (usage: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_creation: Anthropic.Beta.BetaCacheCreation | null;
}): TurnUsage => ({
  input_tokens: usage.input_tokens,
  output_tokens: usage.output_tokens,
  cache_read_input_tokens: usage.cache_read_input_tokens,
  cache_creation_input_tokens: usage.cache_creation_input_tokens,
  cache_creation_1h_input_tokens: usage.cache_creation?.ephemeral_1h_input_tokens ?? null,
});

/** A finished reply: its content blocks, verbatim, and what the API said about it. */
export interface Reply {
  content: ContentBlock[];
  details: ReplyDetails;
}

/**
 * What to store from a finished reply. `asked` is the model the request named.
 *
 * Who answered: `message.model` is always the model that wrote the reply. A `fallback` block
 * marks a switch made during this turn, naming the model that declined; a turn the API sent
 * straight to the fallback model (it does for about an hour after one) carries no block, and only
 * its `fallback_message` usage entry says so.
 */
export function replyOf(message: Anthropic.Beta.BetaMessage, asked?: string): Reply {
  const switched = message.content.filter((block) => block.type === "fallback");
  const iterations = message.usage.iterations ?? [];
  const fellBack = switched.length > 0 || iterations.some((entry) => entry.type === "fallback_message");
  const attempts = iterations.flatMap((entry): Attempt[] =>
    entry.type === "message" || entry.type === "fallback_message"
      ? [{ ...usageOf(entry), model: entry.model ?? asked ?? null }]
      : [],
  );
  return {
    content: message.content as unknown as ContentBlock[],
    details: {
      model: message.model,
      stopReason: message.stop_reason,
      stopDetails: message.stop_details
        ? { category: message.stop_details.category, explanation: message.stop_details.explanation }
        : null,
      usage: usageOf(message.usage),
      servedBy: fellBack ? message.model : null,
      declinedBy: switched[0]?.from.model ?? null,
      attempts: attempts.length > 1 ? attempts : null,
    },
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
 * Asks for the next reply and reports it as it is written. Resolves with what to store —
 * including a reply whose `stopReason` is "refusal", which is an answer, not a failure.
 */
export async function streamReply(
  system: SystemBlock[],
  messages: Anthropic.Beta.BetaMessageParam[],
  settings: Settings,
  onEvent: (event: StreamEvent) => void,
): Promise<Reply> {
  const stream = client.beta.messages.stream(requestFor(system, messages, settings));
  for await (const event of stream) {
    const told = eventOf(event);
    if (told) onEvent(told);
  }
  return replyOf(await stream.finalMessage(), settings.model);
}

/** The function that writes a reply. The server uses streamReply; the tests hand in their own. */
export type Writer = typeof streamReply;

/** A run of the memory model: its instructions, what it is given, and the memory tool to use. */
export interface MemoryRunRequest {
  system: string;
  prompt: string;
  tool: BetaRunnableTool<Anthropic.Beta.BetaMemoryTool20250818Command>;
  settings: Settings;
  /** The most requests the run may make. */
  maxIterations: number;
}

export interface MemoryRunResult {
  /** How the last request ended: "end_turn" when the model finished, "tool_use" when it ran out of steps. */
  stopReason: string | null;
  stopDetails: RefusalDetails | null;
  /** Every request of the run, with what it cost. */
  attempts: Attempt[];
  /** The model's last words: what it says it changed. */
  text: string;
}

/**
 * Runs the memory model until it has finished with the memory tool (or used up its steps). Not
 * streamed: nobody watches it. No stop sequences either — those are for the chat, and a memory
 * file may well contain one.
 */
export async function runMemoryModel(request: MemoryRunRequest): Promise<MemoryRunResult> {
  const { settings } = request;
  const runner = client.beta.messages.toolRunner({
    model: settings.memoryModel,
    max_tokens: 16_000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system: [{ type: "text", text: request.system }],
    messages: [{ role: "user", content: request.prompt }],
    tools: [request.tool],
    max_iterations: request.maxIterations,
    // The whole history goes out each step: no message thread kept on the server.
    thread: false,
    ...(settings.fallbacks && hasFallback(settings.memoryModel)
      ? { betas: [FALLBACK_BETA], fallbacks: "default" as const }
      : {}),
  });
  const attempts: Attempt[] = [];
  let last: Anthropic.Beta.BetaMessage | null = null;
  for await (const message of runner) {
    last = message;
    const { details } = replyOf(message, settings.memoryModel);
    attempts.push(...(details.attempts ?? (details.usage ? [{ ...details.usage, model: details.model }] : [])));
  }
  if (!last) throw new Error("The memory model sent nothing back");
  const { details, content } = replyOf(last, settings.memoryModel);
  return {
    stopReason: details.stopReason,
    stopDetails: details.stopDetails,
    attempts,
    text: content.map(blockText).join("").trim(),
  };
}

/** The function that runs the memory model. The server uses runMemoryModel; the tests their own. */
export type MemoryRunner = typeof runMemoryModel;

/**
 * Counting needs at least one message — a chat nobody has spoken in yet is refused with a 400. So
 * an empty one is counted with a single full stop standing in for the first message, which answers
 * the question actually being asked there: how large is this profile? It costs a token or two of
 * accuracy and nothing else.
 */
export const messagesToCount = (messages: Anthropic.Beta.BetaMessageParam[]): Anthropic.Beta.BetaMessageParam[] =>
  messages.length > 0 ? messages : [{ role: "user", content: "." }];

/** How many input tokens this chat would send as it stands. */
export async function countTokens(
  system: SystemBlock[],
  messages: Anthropic.Beta.BetaMessageParam[],
  settings: Settings,
): Promise<number> {
  const counted = await client.beta.messages.countTokens({
    model: settings.model,
    ...(system.length > 0 ? { system } : {}),
    // Counting runs the same check on thinking blocks as sending does, so it asks for the same.
    thinking,
    betas: [THINKING_BINDING_BETA],
    messages: messagesToCount(messages),
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
