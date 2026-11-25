// A picture's prompt, written by Claude from a scene, for CivitAI to paint.
import type Anthropic from "@anthropic-ai/sdk";
import { dollarsOf } from "../../shared/price.ts";
import {
  blockText,
  LIMITS,
  ORIENTATIONS,
  type Orientation,
  type PictureDraft,
  type PictureDraftReply,
} from "../../shared/protocol.ts";
import { StoreError } from "../errors.ts";
import { asStoreError, client } from "./client.ts";
import { replyOf } from "./reply.ts";

/** The shape Claude answers in when it writes a picture's prompt. */
const PICTURE_SCHEMA = {
  type: "object",
  properties: {
    prompt: { type: "string" },
    negativePrompt: { type: "string" },
    orientation: { type: "string", enum: [...ORIENTATIONS] },
    caption: { type: "string" },
  },
  required: ["prompt", "negativePrompt", "orientation", "caption"],
  additionalProperties: false,
} as const;

/** Reads Claude's answer as a picture's draft, or says what was wrong with it. */
export function draftOf(text: string): PictureDraft {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new StoreError(502, "Claude's answer wasn't a picture prompt. Try again.", "api");
  }
  const fields = (raw ?? {}) as Record<string, unknown>;
  const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  const prompt = str(fields.prompt, LIMITS.picturePrompt);
  if (!prompt) throw new StoreError(502, "Claude wrote an empty picture prompt. Try again.", "api");
  return {
    prompt,
    negativePrompt: str(fields.negativePrompt, LIMITS.picturePrompt),
    orientation: ORIENTATIONS.includes(fields.orientation as Orientation)
      ? (fields.orientation as Orientation)
      : "portrait",
    caption: str(fields.caption, LIMITS.pictureCaption),
  };
}

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
