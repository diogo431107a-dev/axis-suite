// Working out a moment: one structured request that reads the companion, its memory and the chat up
// to the moment, and answers with the scene and how each line is said (see ../scene/sheet.ts).
import type Anthropic from "@anthropic-ai/sdk";
import { dollarsOf } from "../../shared/price.ts";
import { blockText, FEELINGS, STRENGTHS } from "../../shared/protocol.ts";
import { StoreError } from "../errors.ts";
import { asStoreError, client } from "./client.ts";
import { replyOf } from "./reply.ts";

/** What is asked: the instructions, what stays the same for a companion, and the moment itself. */
export interface SceneAsk {
  system: string;
  /** The profile and memory: the same for every moment with the companion, so it is cached. */
  background: string;
  /** The chat up to the moment, its lines, and what to do. */
  moment: string;
}

export interface SceneAnswer {
  /** The answer as Claude gave it; ../scene/sheet.ts reads it. */
  raw: unknown;
  model: string;
  cost: number | null;
}

const text = { type: "string" } as const;

/** The shape Claude answers in. */
const SCENE_SCHEMA = {
  type: "object",
  properties: {
    place: text,
    time: text,
    weather: text,
    light: text,
    people: {
      type: "array",
      items: {
        type: "object",
        properties: { name: text, appearance: text, clothes: text, action: text, mood: text },
        required: ["name", "appearance", "clothes", "action", "mood"],
        additionalProperties: false,
      },
    },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          line: { type: "integer" },
          feeling: { type: "string", enum: [...FEELINGS] },
          strength: { type: "integer", enum: [...STRENGTHS] },
        },
        required: ["line", "feeling", "strength"],
        additionalProperties: false,
      },
    },
  },
  required: ["place", "time", "weather", "light", "people", "lines"],
  additionalProperties: false,
} as const;

/**
 * Asks Claude to work out a moment. Not streamed: nothing is shown until it is whole. A decline
 * comes back as a refusal the page shows.
 */
export async function readScene(ask: SceneAsk, model: string): Promise<SceneAnswer> {
  let message: Anthropic.Beta.BetaMessage;
  try {
    message = await client.beta.messages.create({
      model,
      max_tokens: 8_000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: { type: "json_schema", schema: SCENE_SCHEMA } },
      system: [{ type: "text", text: ask.system }],
      messages: [
        {
          role: "user",
          content: [
            // Everything about the companion first, cached, so another moment with it reads it cheaply.
            { type: "text", text: ask.background, cache_control: { type: "ephemeral" } },
            { type: "text", text: ask.moment },
          ],
        },
      ],
    });
  } catch (err) {
    throw asStoreError(err);
  }
  const { details, content } = replyOf(message, model);
  if (details.stopReason === "refusal") {
    const why = details.stopDetails?.category ? ` (${details.stopDetails.category})` : "";
    throw new StoreError(422, `Claude declined to read this moment${why}.`, "api");
  }
  if (details.stopReason === "max_tokens") {
    throw new StoreError(502, "Claude ran out of room reading this moment. Try again.", "api");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(content.map(blockText).join(""));
  } catch {
    throw new StoreError(502, "Claude's reading of this moment wasn't readable. Try again.", "api");
  }
  return { raw, model: details.model ?? model, cost: dollarsOf(details) };
}

/** The function that reads a moment. The server uses readScene; the tests hand in their own. */
export type SceneReader = typeof readScene;
