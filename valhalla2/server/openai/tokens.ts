// Each GPT model's context window, and how large a chat is before it is sent.
//
// OpenAI's GET /v1/models/{id} says nothing of a model's window, so the windows are written down
// here, as published. A model not listed has no known window: the page simply shows none, and a
// chat without memory keeps to the usual 200K limit (../memory/history.ts).
//
// Counting is OpenAI's POST /v1/responses/input_tokens, with the very input a reply would send.
import type Anthropic from "@anthropic-ai/sdk";
import type { Settings } from "../../shared/protocol.ts";
import type { SystemBlock } from "../prompt.ts";
import { requestFor } from "../responses/reply.ts";
import { OPENAI, openai } from "./client.ts";

/** Context windows as OpenAI published them on 2026-11-28. */
const WINDOWS: Readonly<Record<string, number>> = {
  "gpt-6-luna": 1_050_000,
  "gpt-6.1-terra": 1_050_000,
  "gpt-6.2-sol": 1_050_000,
  "gpt-6.2-astra": 1_050_000,
};

/** The model's context window, or null when it isn't known. */
export const openAiContextWindow = (model: string): Promise<number | null> => Promise.resolve(WINDOWS[model] ?? null);

/** How many tokens the chat would send, or null when it can't be counted (no key, or a failure). */
export async function countOpenAiTokens(
  system: SystemBlock[],
  messages: Anthropic.Beta.BetaMessageParam[],
  settings: Settings,
): Promise<number | null> {
  if (!openai) return null;
  const { model, input } = requestFor(OPENAI, system, messages, settings);
  try {
    const counted = await openai.responses.inputTokens.count({ model, input });
    return counted.input_tokens;
  } catch {
    // Only an estimate for the page; not worth refusing the chat over.
    return null;
  }
}
