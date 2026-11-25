// How large a chat is, against the model's context window.
import type Anthropic from "@anthropic-ai/sdk";
import type { Settings } from "../../shared/protocol.ts";
import type { SystemBlock } from "../prompt.ts";
import { client, thinking, THINKING_BINDING_BETA } from "./client.ts";

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
