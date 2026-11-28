// A picture's prompt, written on a Responses API by a Grok or GPT companion's own model, for the
// picture engine to paint, from the scene with memory or from the profile and one message without
// (../scene/context.ts).
import type { Response, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { dollarsOf } from "../../shared/price.ts";
import { blockText, type PictureDraftReply } from "../../shared/protocol.ts";
import { StoreError } from "../errors.ts";
import { draftOf, PICTURE_SCHEMA } from "../pictures/draft.ts";
import { apiErrorOf, type ResponsesApi } from "./api.ts";
import { replyOf } from "./reply.ts";

/** The request for a picture's prompt, as it goes to the API. */
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

/** Reads the model's answer as a picture's draft, with what it cost. */
export function draftFrom(api: ResponsesApi, response: Response, model: string): Omit<PictureDraftReply, "scene"> {
  const { details, content } = replyOf(response, model);
  if (details.stopReason === "refusal") {
    const why = details.stopDetails?.explanation ? `: ${details.stopDetails.explanation}` : "";
    throw new StoreError(
      422,
      `${api.name} declined to describe this message${why}. Change the note, or try another message.`,
      "api",
    );
  }
  if (details.stopReason === "max_tokens") {
    throw new StoreError(502, `${api.name} ran out of room writing the picture prompt. Try again.`, "api");
  }
  return { ...draftOf(content.map(blockText).join(""), api.name), cost: dollarsOf(details) };
}

/**
 * Asks the API for a picture's prompt. Not streamed: it is short, and nothing is shown until it is
 * whole. A decline comes back as a refusal the page shows, not as a prompt.
 */
export async function writePicturePromptOn(
  api: ResponsesApi,
  request: { system: string; prompt: string },
  model: string,
): Promise<Omit<PictureDraftReply, "scene">> {
  let response: Response;
  try {
    response = await api.client().responses.create(pictureRequestFor(request, model));
  } catch (err) {
    throw apiErrorOf(api.vendor, err) ?? err;
  }
  return draftFrom(api, response, model);
}
