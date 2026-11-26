// A chat reply: the request, streamed back as it is written, and what is stored of it.
import type Anthropic from "@anthropic-ai/sdk";
import type { Attempt, ContentBlock, ReplyDetails, Settings, StreamEvent, TurnUsage } from "../../shared/protocol.ts";
import type { SystemBlock } from "../prompt.ts";
import { client, FALLBACK_BETA, thinking, THINKING_BINDING_BETA } from "./client.ts";

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

/** What a writer is told besides the request itself. */
export interface WriteOptions {
  /** Keeps one chat's turns on the same cache, for an API that wants a key. Claude's needs none. */
  cacheKey?: string;
}

/**
 * The function that writes a reply. The server uses writeReply (../chat/write.ts), which hands the
 * request to Claude or Grok by the model; the tests hand in their own.
 */
export type Writer = (
  system: SystemBlock[],
  messages: Anthropic.Beta.BetaMessageParam[],
  settings: Settings,
  onEvent: (event: StreamEvent) => void,
  options?: WriteOptions,
) => Promise<Reply>;
