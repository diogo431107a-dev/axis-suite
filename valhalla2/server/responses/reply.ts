// A chat reply on a Responses API (Grok's, OpenAI's): the request, streamed back as it is written,
// and what is stored of it.
//
// It is built from the same system prompt and messages a Claude reply is (../prompt.ts), with these
// differences, each forced by the API:
//
// - Only text goes out. The reasoning comes back encrypted and is not kept: it would never be sent
//   again. (A companion is on one API from the day it is created, so there is no Claude thinking
//   in its chats; a block of any other kind would be dropped all the same.)
// - Effort goes out as the API takes it (api.effort): Grok has no "max", and sends "xhigh".
// - A temperature goes out only on an API that takes one (Grok), and only when the companion has
//   one; otherwise the API uses its own.
// - The reasoning models refuse `stop`, so stop sequences are applied here: the moment the
//   streamed text reaches one, the reply is cut there and the request is ended.
// - Caching is automatic. `prompt_cache_key` keeps one chat's turns on the same cache.
// - `store: false`: the whole history goes out each turn, so the API need not keep a copy.
import type {
  EasyInputMessage,
  Response,
  ResponseCreateParamsStreaming,
  ResponseStreamEvent,
} from "openai/resources/responses/responses";
import type Anthropic from "@anthropic-ai/sdk";
import { blockText, type ContentBlock, type Settings, type StreamEvent } from "../../shared/protocol.ts";
import type { Reply, WriteOptions } from "../claude/reply.ts";
import { StoreError } from "../errors.ts";
import type { SystemBlock } from "../prompt.ts";
import { apiErrorOf, type ResponsesApi } from "./api.ts";

const textOf = (content: Anthropic.Beta.BetaMessageParam["content"]): string =>
  typeof content === "string" ? content : (content as unknown as ContentBlock[]).map(blockText).join("");

export function requestFor(
  api: ResponsesApi,
  system: SystemBlock[],
  messages: Anthropic.Beta.BetaMessageParam[],
  settings: Settings,
  cacheKey?: string,
): ResponseCreateParamsStreaming {
  const input: EasyInputMessage[] = system.map((block) => ({ role: "system", content: block.text }));
  for (const message of messages) {
    const text = textOf(message.content);
    // A message with no text left (thinking only) would be an empty turn; better without it.
    if (!text) continue;
    // A mid-chat instruction goes out with role "system": the API takes the roles in any order.
    input.push({ role: message.role as EasyInputMessage["role"], content: text });
  }
  return {
    model: settings.model,
    input,
    // Always sent: Grok's default is "high", slow and dear for dialogue, and OpenAI's varies by model.
    reasoning: { effort: api.effort[settings.effort] },
    max_output_tokens: settings.maxTokens,
    stream: true,
    store: false,
    ...(cacheKey ? { prompt_cache_key: cacheKey } : {}),
    // Only on an API that takes one, and only when one is chosen; otherwise its own default.
    ...(api.temperature && typeof settings.temperature === "number" ? { temperature: settings.temperature } : {}),
  };
}

/** What the page should be told about one event from the API, or nothing when it needs no word. */
export function eventOf(event: ResponseStreamEvent): StreamEvent | null {
  if (
    event.type === "response.reasoning_text.delta" ||
    event.type === "response.reasoning_summary_text.delta" ||
    (event.type === "response.output_item.added" && event.item.type === "reasoning")
  ) {
    return { type: "thinking" };
  }
  if (event.type === "response.output_text.delta") return { type: "delta", text: event.delta };
  return null;
}

/**
 * Stop sequences, applied to the text as it streams. What could still turn out to be the start of
 * one is held back, so the page never shows words that are then taken away.
 */
export function stopWatch(stops: readonly string[]) {
  const wanted = stops.filter((stop) => stop !== "");
  let text = "";
  let sent = 0;
  let cut: number | null = null;
  /** How much of the end of `text` is the start of some stop sequence. */
  const pending = (): number => {
    let longest = 0;
    for (const stop of wanted) {
      for (let size = Math.min(stop.length - 1, text.length); size > longest; size--) {
        if (text.endsWith(stop.slice(0, size))) {
          longest = size;
          break;
        }
      }
    }
    return longest;
  };
  return {
    /** Takes the next piece; says what can be shown now, and whether the reply ends here. */
    feed(delta: string): { show: string; stopped: boolean } {
      if (cut !== null) return { show: "", stopped: true };
      text += delta;
      let first = -1;
      for (const stop of wanted) {
        const at = text.indexOf(stop);
        if (at !== -1 && (first === -1 || at < first)) first = at;
      }
      if (first !== -1) {
        cut = first;
        const show = first > sent ? text.slice(sent, first) : "";
        sent = Math.max(sent, first);
        return { show, stopped: true };
      }
      const upTo = text.length - pending();
      const show = upTo > sent ? text.slice(sent, upTo) : "";
      sent = Math.max(sent, upTo);
      return { show, stopped: false };
    },
    /** What was held back, now that the reply has ended without a stop sequence. */
    flush(): string {
      const show = text.slice(sent);
      sent = text.length;
      return show;
    },
    /** The reply's text, cut where it stopped. */
    get text(): string {
      return cut === null ? text : text.slice(0, cut);
    },
  };
}

/** A reply cut at a stop sequence. The request was ended, so the API never said what it used. */
export function cutReply(text: string, model: string): Reply {
  return {
    content: text ? [{ type: "text", text }] : [],
    details: {
      model,
      stopReason: "stop_sequence",
      stopDetails: null,
      usage: null,
      servedBy: null,
      declinedBy: null,
      attempts: null,
    },
  };
}

/** What to store from a finished response. `asked` is the model the request named. */
export function replyOf(response: Response, asked: string): Reply {
  const parts = response.output.flatMap((item) => (item.type === "message" ? item.content : []));
  const text = parts.map((part) => (part.type === "output_text" ? part.text : "")).join("");
  const refusal = parts.map((part) => (part.type === "refusal" ? part.refusal : "")).join("");
  const reason = response.incomplete_details?.reason ?? null;
  const declined = refusal !== "" || reason === "content_filter";
  const stopReason = declined
    ? "refusal"
    : response.status === "incomplete"
      ? reason === "max_output_tokens"
        ? "max_tokens"
        : (reason ?? "incomplete")
      : "end_turn";
  const usage = response.usage;
  const cached = usage?.input_tokens_details?.cached_tokens ?? 0;
  // OpenAI reports what it wrote to the cache (and bills it); xAI doesn't, and writes nothing dearer.
  const written = usage?.input_tokens_details?.cache_write_tokens ?? 0;
  return {
    content: text ? [{ type: "text", text }] : [],
    details: {
      model: response.model || asked,
      stopReason,
      stopDetails: declined
        ? { category: reason === "content_filter" ? "content_filter" : null, explanation: refusal || null }
        : null,
      usage: usage
        ? {
            // The API counts the cached tokens inside input_tokens; Valhalla 2 keeps them apart, as
            // Claude does.
            input_tokens: Math.max(0, usage.input_tokens - cached - written),
            output_tokens: usage.output_tokens,
            cache_read_input_tokens: cached,
            cache_creation_input_tokens: written,
            cache_creation_1h_input_tokens: null,
          }
        : null,
      servedBy: null,
      declinedBy: null,
      attempts: null,
    },
  };
}

/**
 * Asks the API for the next reply and reports it as it is written. Resolves with what to store —
 * including a declined reply, which is an answer, not a failure. A failure of the API is refused
 * with its own vendor's name: Grok's and OpenAI's errors are the same SDK's, and can't be told
 * apart later.
 */
export async function streamResponsesReply(
  api: ResponsesApi,
  system: SystemBlock[],
  messages: Anthropic.Beta.BetaMessageParam[],
  settings: Settings,
  onEvent: (event: StreamEvent) => void,
  options: WriteOptions = {},
): Promise<Reply> {
  try {
    return await streamed(api, system, messages, settings, onEvent, options);
  } catch (err) {
    throw apiErrorOf(api.vendor, err) ?? err;
  }
}

async function streamed(
  api: ResponsesApi,
  system: SystemBlock[],
  messages: Anthropic.Beta.BetaMessageParam[],
  settings: Settings,
  onEvent: (event: StreamEvent) => void,
  options: WriteOptions,
): Promise<Reply> {
  const stream = await api.client().responses.create(requestFor(api, system, messages, settings, options.cacheKey));
  const watch = stopWatch(settings.stopSequences);
  let model = settings.model;
  let thinking = false;
  let final: Response | null = null;
  for await (const event of stream) {
    if (event.type === "response.created") model = event.response.model || model;
    if (event.type === "response.completed" || event.type === "response.incomplete") final = event.response;
    if (event.type === "response.failed") {
      const why = event.response.error?.message;
      throw new StoreError(502, `${api.name} could not write this reply${why ? `: ${why}` : ""}. Try again.`, "api");
    }
    const told = eventOf(event);
    if (told?.type === "thinking") {
      // Said once: the page only needs to know it started.
      if (!thinking) onEvent(told);
      thinking = true;
    } else if (told?.type === "delta") {
      const { show, stopped } = watch.feed(told.text);
      if (show) onEvent({ type: "delta", text: show });
      // Leaving the loop ends the request: nothing more is written, or paid for.
      if (stopped) return cutReply(watch.text, model);
    }
  }
  if (!final) throw new StoreError(502, `${api.name}'s reply ended before it was finished. Try again.`, "api");
  const rest = watch.flush();
  if (rest) onEvent({ type: "delta", text: rest });
  return replyOf(final, settings.model);
}
