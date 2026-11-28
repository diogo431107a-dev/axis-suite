// Which API a chat talks to: Claude (../claude/), Grok (../grok/) or GPT (../openai/), by the
// companion; Grok's and GPT's requests are both built in ../responses/. A companion is on one API
// from the day it is created, and a request for a model of another is refused here rather than
// sent: nothing a companion says goes to any API but its own.
import type Anthropic from "@anthropic-ai/sdk";
import {
  providerOf,
  type Companion,
  type PictureDraftReply,
  type Provider,
  type Settings,
  type TokenView,
} from "../../shared/protocol.ts";
import { asStoreError } from "../claude/client.ts";
import { runMemoryModel, type MemoryRunner } from "../claude/memory.ts";
import { writePicturePrompt } from "../claude/pictures.ts";
import { readWithClaude } from "../claude/reading.ts";
import { streamReply, type Writer } from "../claude/reply.ts";
import { contextWindow, countTokens } from "../claude/tokens.ts";
import { config } from "../config.ts";
import { invalid, type StoreError } from "../errors.ts";
import { windowWithout } from "../memory/history.ts";
import { GROK } from "../grok/client.ts";
import { grokContextWindow } from "../grok/tokens.ts";
import { OPENAI } from "../openai/client.ts";
import { countOpenAiTokens, openAiContextWindow } from "../openai/tokens.ts";
import type { ResponsesApi } from "../responses/api.ts";
import { runResponsesMemory } from "../responses/memory.ts";
import { writePicturePromptOn } from "../responses/pictures.ts";
import { readOn } from "../responses/reading.ts";
import { streamResponsesReply } from "../responses/reply.ts";
import type { SystemBlock } from "../prompt.ts";
import type { Reader } from "../reading.ts";
import type { WindowSize } from "./turn.ts";

/** What sets each Responses API apart where a chat is concerned. */
const RESPONSES: Record<
  Exclude<Provider, "anthropic">,
  { api: ResponsesApi; window: (model: string) => Promise<number | null>; windowTokens: () => number }
> = {
  xai: { api: GROK, window: grokContextWindow, windowTokens: () => config.grokWindowTokens },
  openai: { api: OPENAI, window: openAiContextWindow, windowTokens: () => config.openaiWindowTokens },
};

/** The companion's API, checked against the model about to be asked. */
export function providerFor(model: string, provider: Provider = providerOf(model)): Provider {
  if (providerOf(model) !== provider) {
    invalid(`${model} isn't a model of this companion's API, so it wasn't asked`);
  }
  return provider;
}

/** Writes a reply on the companion's API. */
export const writeReply: Writer = (system, messages, settings, onEvent, options) => {
  const provider = providerFor(settings.model, options?.provider);
  return provider === "anthropic"
    ? streamReply(system, messages, settings, onEvent)
    : streamResponsesReply(RESPONSES[provider].api, system, messages, settings, onEvent, options);
};

/** Runs the memory model on its own API: Claude's for a Claude companion, Grok's for Grok, GPT's for GPT. */
export const runMemoryFor: MemoryRunner = (request) => {
  const provider = providerFor(request.settings.memoryModel);
  return provider === "anthropic" ? runMemoryModel(request) : runResponsesMemory(RESPONSES[provider].api, request);
};

/**
 * Writes a picture's prompt on the companion's API: Claude's picture-prompt model for a Claude
 * companion, a Grok or GPT companion's own model otherwise.
 */
export function writePictureFor(
  companion: Companion,
  request: { system: string; prompt: string },
): Promise<Omit<PictureDraftReply, "scene">> {
  if (companion.provider !== "anthropic") {
    const model = companion.settings.model;
    providerFor(model, companion.provider);
    return writePicturePromptOn(RESPONSES[companion.provider].api, request, model);
  }
  return writePicturePrompt(request, config.pictures.promptModel);
}

/** A reading (the tags a reply is read aloud with, a scene) on the companion's own API. */
export const readOnItsApi: Reader = async (ask) => {
  const provider = providerFor(ask.model, ask.provider);
  return provider === "anthropic" ? readWithClaude(ask) : readOn(RESPONSES[provider].api, ask);
};

/** The model's context window, asked of its own API. */
const windowOf = (model: string, provider: Provider): Promise<number | null> =>
  provider === "anthropic" ? contextWindow(model) : RESPONSES[provider].window(model);

/**
 * How much of a chat goes out each turn. With memory, the configured window (a larger one on Grok
 * and GPT): what slides out is folded into memory. Without, a window sized from the model's own
 * (windowWithout in history.ts), which also caps the larger window with memory on a smaller model.
 */
export async function chatWindow(companion: Companion): Promise<WindowSize> {
  if (companion.memory && companion.provider === "anthropic") {
    return { tokens: config.windowTokens, chunk: config.windowChunk };
  }
  const { model, maxTokens } = companion.settings;
  const provider = providerFor(model, companion.provider);
  const largest = windowWithout(await windowOf(model, provider), maxTokens);
  if (companion.memory && provider !== "anthropic") {
    return { tokens: Math.min(RESPONSES[provider].windowTokens(), largest.tokens), chunk: config.windowChunk };
  }
  return { ...largest, chunk: config.windowChunk };
}

/**
 * A failure from any of the APIs as something the page can show. Grok's and GPT's are refused with
 * their own vendor's name where they happen (../responses/), so they arrive here as refusals.
 */
export const apiError = (err: unknown): StoreError => asStoreError(err);

/**
 * How large this chat is against the model's context window. Grok can't count a chat before it
 * is sent, so for a Grok model only the window is known.
 */
export async function tokensFor(
  system: SystemBlock[],
  messages: Anthropic.Beta.BetaMessageParam[],
  settings: Settings,
  provider?: Provider,
): Promise<TokenView> {
  const on = providerFor(settings.model, provider);
  if (on === "xai") {
    return { inputTokens: null, contextWindow: await grokContextWindow(settings.model) };
  }
  const [inputTokens, window] =
    on === "openai"
      ? await Promise.all([countOpenAiTokens(system, messages, settings), openAiContextWindow(settings.model)])
      : await Promise.all([countTokens(system, messages, settings), contextWindow(settings.model)]);
  return { inputTokens, contextWindow: window };
}
