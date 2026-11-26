// A picture's prompt, written by Grok for a Grok companion, for CivitAI to paint. A Grok companion
// has no memory and no scene, so what it reads is the profile and one message (../scene/context.ts).
import type { Response, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { dollarsOf } from "../../shared/price.ts";
import { blockText, type PictureDraftReply } from "../../shared/protocol.ts";
import { StoreError } from "../errors.ts";
import { draftOf, PICTURE_SCHEMA } from "../pictures/draft.ts";
import { grokClient, grokError } from "./client.ts";
import { replyOf } from "./reply.ts";

/** The request for a picture's prompt, as it goes to xAI. */
export function pictureRequestFor(
  request: { system: string; prompt: string },
  model: string,
): ResponseCreateParamsNonStreaming {
  return {
    model,
    input: [
      { role: "system", content: request.system },
      { role: "user", content: request.prompt },
    ],
    reasoning: { effort: "low" },
    max_output_tokens: 8_000,
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: "picture_prompt",
        schema: PICTURE_SCHEMA as unknown as Record<string, unknown>,
        strict: true,
      },
    },
  };
}

/** Reads Grok's answer as a picture's draft, with what it cost. */
export function grokDraftOf(response: Response, model: string): Omit<PictureDraftReply, "scene"> {
  const { details, content } = replyOf(response, model);
  if (details.stopReason === "refusal") {
    const why = details.stopDetails?.explanation ? `: ${details.stopDetails.explanation}` : "";
    throw new StoreError(
      422,
      `Grok declined to describe this message${why}. Change the note, or try another message.`,
      "api",
    );
  }
  if (details.stopReason === "max_tokens") {
    throw new StoreError(502, "Grok ran out of room writing the picture prompt. Try again.", "api");
  }
  return { ...draftOf(content.map(blockText).join(""), "Grok"), cost: dollarsOf(details) };
}

/**
 * Asks Grok for a picture's prompt. Not streamed: it is short, and nothing is shown until it is
 * whole. A decline comes back as a refusal the page shows, not as a prompt.
 */
export async function writeGrokPicturePrompt(
  request: { system: string; prompt: string },
  model: string,
): Promise<Omit<PictureDraftReply, "scene">> {
  let response: Response;
  try {
    response = await grokClient().responses.create(pictureRequestFor(request, model));
  } catch (err) {
    throw grokError(err) ?? err;
  }
  return grokDraftOf(response, model);
}
