// Which API writes a chat reply: Claude (../claude/) or Grok (../grok/), by the companion's model.
// Everything else — the memory model, scene reading, picture prompts — is always Claude.
import type Anthropic from "@anthropic-ai/sdk";
import { providerOf, type Settings, type TokenView } from "../../shared/protocol.ts";
import { asStoreError } from "../claude/client.ts";
import { streamReply, type Writer } from "../claude/reply.ts";
import { contextWindow, countTokens } from "../claude/tokens.ts";
import type { StoreError } from "../errors.ts";
import { grokError } from "../grok/client.ts";
import { streamGrokReply } from "../grok/reply.ts";
import { grokContextWindow } from "../grok/tokens.ts";
import type { SystemBlock } from "../prompt.ts";

/** Writes a reply on the API the companion's model belongs to. */
export const writeReply: Writer = (system, messages, settings, onEvent, options) =>
  providerOf(settings.model) === "xai"
    ? streamGrokReply(system, messages, settings, onEvent, options)
    : streamReply(system, messages, settings, onEvent);

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
): Promise<TokenView> {
  if (providerOf(settings.model) === "xai") {
    return { inputTokens: null, contextWindow: await grokContextWindow(settings.model) };
  }
  const [inputTokens, window] = await Promise.all([
    countTokens(system, messages, settings),
    contextWindow(settings.model),
  ]);
  return { inputTokens, contextWindow: window };
}
