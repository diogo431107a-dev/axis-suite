// A run of the memory model, with the memory tool, until it is done.
import type Anthropic from "@anthropic-ai/sdk";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import { blockText, hasFallback, type Attempt, type RefusalDetails, type Settings } from "../../shared/protocol.ts";
import { client, FALLBACK_BETA } from "./client.ts";
import { replyOf } from "./reply.ts";

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
    // Each step re-sends everything before it; this breakpoint follows the run as it grows, so
    // each step reads the earlier ones from the cache instead of paying for them again. The run
    // takes seconds, so the 5-minute cache is plenty and costs least to write.
    cache_control: { type: "ephemeral" },
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
