// Which API a chat talks to: Claude (../claude/) or Grok (../grok/), by the companion. A companion
// is one or the other from the day it is created, and a request for a model of the other API is
// refused here rather than sent: nothing a Grok companion says goes to Anthropic, or the reverse.
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
import { GROK, grokError } from "../grok/client.ts";
import { grokContextWindow } from "../grok/tokens.ts";
import { runResponsesMemory } from "../responses/memory.ts";
import { writePicturePromptOn } from "../responses/pictures.ts";
import { readOn } from "../responses/reading.ts";
import { streamResponsesReply } from "../responses/reply.ts";
import type { SystemBlock } from "../prompt.ts";
import type { Reader } from "../reading.ts";
import type { WindowSize } from "./turn.ts";

/** The companion's API, checked against the model about to be asked. */
export function providerFor(model: string, provider: Provider = providerOf(model)): Provider {
  if (providerOf(model) !== provider) {
    invalid(`${model} isn't a model of this companion's API, so it wasn't asked`);
  }
  return provider;
}

/** Writes a reply on the companion's API. */
export const writeReply: Writer = (system, messages, settings, onEvent, options) =>
  providerFor(settings.model, options?.provider) === "xai"
    ? streamResponsesReply(GROK, system, messages, settings, onEvent, options)
    : streamReply(system, messages, settings, onEvent);

/** Runs the memory model on its own API: Claude's for a Claude companion, Grok's for a Grok one. */
export const runMemoryFor: MemoryRunner = (request) =>
  providerFor(request.settings.memoryModel) === "xai" ? runResponsesMemory(GROK, request) : runMemoryModel(request);

/**
 * Writes a picture's prompt on the companion's API: Claude's picture-prompt model for a Claude
 * companion, a Grok companion's own model for a Grok one.
 */
export function writePictureFor(
  companion: Companion,
  request: { system: string; prompt: string },
): Promise<Omit<PictureDraftReply, "scene">> {
  if (companion.provider === "xai") {
    const model = companion.settings.model;
    providerFor(model, "xai");
    return writePicturePromptOn(GROK, request, model);
  }
  return writePicturePrompt(request, config.pictures.promptModel);
}

/** A reading (the tags a reply is read aloud with, a scene) on the companion's own API. */
export const readOnItsApi: Reader = async (ask) =>
  providerFor(ask.model, ask.provider) === "xai" ? readOn(GROK, ask) : readWithClaude(ask);

/**
 * How much of a chat goes out each turn. With memory, the configured window (a larger one on Grok):
 * what slides out is folded into memory. Without, a window sized from the model's own
 * (windowWithout in history.ts), which also caps Grok's window with memory on a smaller model.
 */
export async function chatWindow(companion: Companion): Promise<WindowSize> {
  if (companion.memory && companion.provider === "anthropic") {
    return { tokens: config.windowTokens, chunk: config.windowChunk };
  }
  const { model, maxTokens } = companion.settings;
  const window =
    providerFor(model, companion.provider) === "xai" ? await grokContextWindow(model) : await contextWindow(model);
  const largest = windowWithout(window, maxTokens);
  if (companion.memory) return { tokens: Math.min(config.grokWindowTokens, largest.tokens), chunk: config.windowChunk };
  return { ...largest, chunk: config.windowChunk };
}

/** A failure from either API as something the page can show. */
export const apiError = (err: unknown): StoreError => grokError(err) ?? asStoreError(err);

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
  if (providerFor(settings.model, provider) === "xai") {
    return { inputTokens: null, contextWindow: await grokContextWindow(settings.model) };
  }
  const [inputTokens, window] = await Promise.all([
    countTokens(system, messages, settings),
    contextWindow(settings.model),
  ]);
  return { inputTokens, contextWindow: window };
}
