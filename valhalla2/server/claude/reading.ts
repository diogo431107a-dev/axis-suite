// A reading (../reading.ts) on Claude: one structured request, not streamed, with the companion's
// profile and memory first and cached, so another reading for the same companion costs little.
import type Anthropic from "@anthropic-ai/sdk";
import { dollarsOf } from "../../shared/price.ts";
import { blockText } from "../../shared/protocol.ts";
import { StoreError } from "../errors.ts";
import type { ReadingAnswer, ReadingAsk } from "../reading.ts";
import { asStoreError, client } from "./client.ts";
import { replyOf } from "./reply.ts";

/** The request as it goes to Anthropic. */
export function claudeReadingRequest(ask: ReadingAsk): Anthropic.Beta.MessageCreateParamsNonStreaming {
  return {
    model: ask.model,
    max_tokens: 8_000,
    thinking: { type: "adaptive" },
    output_config: { effort: ask.effort, format: { type: "json_schema", schema: ask.schema } },
    system: [{ type: "text", text: ask.system }],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: ask.background, cache_control: { type: "ephemeral" } },
          { type: "text", text: ask.moment },
        ],
      },
    ],
  };
}

/** Asks Claude. A decline comes back as a refusal the page shows. */
export async function readWithClaude(ask: ReadingAsk): Promise<ReadingAnswer> {
  let message: Anthropic.Beta.BetaMessage;
  try {
    message = await client.beta.messages.create(claudeReadingRequest(ask));
  } catch (err) {
    throw asStoreError(err);
  }
  const { details, content } = replyOf(message, ask.model);
  if (details.stopReason === "refusal") {
    const why = details.stopDetails?.category ? ` (${details.stopDetails.category})` : "";
    throw new StoreError(422, `Claude declined to read ${ask.what}${why}.`, "api");
  }
  if (details.stopReason === "max_tokens") {
    throw new StoreError(502, `Claude ran out of room reading ${ask.what}. Try again.`, "api");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(content.map(blockText).join(""));
  } catch {
    throw new StoreError(502, `Claude's reading of ${ask.what} wasn't readable. Try again.`, "api");
  }
  return { raw, model: details.model ?? ask.model, cost: dollarsOf(details) };
}
