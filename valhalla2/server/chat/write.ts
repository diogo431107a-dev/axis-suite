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
import { writePicturePrompt } from "../claude/pictures.ts";
import { streamReply, type Writer } from "../claude/reply.ts";
import { contextWindow, countTokens } from "../claude/tokens.ts";
import { config } from "../config.ts";
import { invalid, type StoreError } from "../errors.ts";
import { grokError } from "../grok/client.ts";
import { writeGrokPicturePrompt } from "../grok/pictures.ts";
import { streamGrokReply } from "../grok/reply.ts";
import { grokContextWindow } from "../grok/tokens.ts";
import type { SystemBlock } from "../prompt.ts";

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
    ? streamGrokReply(system, messages, settings, onEvent, options)
    : streamReply(system, messages, settings, onEvent);

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
    return writeGrokPicturePrompt(request, model);
  }
  return writePicturePrompt(request, config.pictures.promptModel);
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
