// A picture's prompt, written by Claude from a scene, for CivitAI to paint.
import type Anthropic from "@anthropic-ai/sdk";
import { dollarsOf } from "../../shared/price.ts";
import { blockText, type PictureDraftReply } from "../../shared/protocol.ts";
import { StoreError } from "../errors.ts";
import { draftOf, PICTURE_SCHEMA } from "../pictures/draft.ts";
import { asStoreError, client } from "./client.ts";
import { replyOf } from "./reply.ts";

/**
 * Asks Claude for a picture's prompt. Not streamed: it is short, and nothing is shown until it is
 * whole. A decline comes back as a refusal the page shows, not as a prompt.
 */
export async function writePicturePrompt(
  request: { system: string; prompt: string },
  model: string,
): Promise<Omit<PictureDraftReply, "scene">> {
  let message: Anthropic.Beta.BetaMessage;
  try {
    message = await client.beta.messages.create({
      model,
      max_tokens: 8_000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: { type: "json_schema", schema: PICTURE_SCHEMA } },
      system: [{ type: "text", text: request.system }],
      messages: [{ role: "user", content: request.prompt }],
    });
  } catch (err) {
    throw asStoreError(err);
  }
  const { details, content } = replyOf(message, model);
  if (details.stopReason === "refusal") {
    const why = details.stopDetails?.category ? ` (${details.stopDetails.category})` : "";
    throw new StoreError(
      422,
      `Claude declined to describe this scene${why}. Change the note, or try another moment.`,
      "api",
    );
  }
  if (details.stopReason === "max_tokens") {
    throw new StoreError(502, "Claude ran out of room writing the picture prompt. Try again.", "api");
  }
  return { ...draftOf(content.map(blockText).join("")), cost: dollarsOf(details) };
}

/** The function that writes a picture's prompt. The server uses writePicturePrompt; the tests their own. */
export type PicturePromptWriter = typeof writePicturePrompt;
