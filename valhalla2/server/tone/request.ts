// What the tone model is asked about one reply: the companion's profile, the chat just before it
// (about `toneTokens` of it), and the reply as numbered lines. No memory: how a line is said
// depends on who says it and what came just before, and the reading is kept cheap.
//
// For a companion read in one of Grok's voices, which also make sounds (a sigh, a laugh), the model
// is asked for those too: a note after the companion's tone instructions, and a sound in the
// answer. The note is part of what the instructions' hash covers, so moving to or from a Grok voice
// reads the tags again; a companion on Azure is asked just what it always was.
import { createHash } from "node:crypto";
import {
  blockText,
  FEELINGS,
  SOUNDS,
  STRENGTHS,
  type Companion,
  type Effort,
  type Message,
  type Provider,
} from "../../shared/protocol.ts";
import { promptOf } from "../../shared/prompts.ts";
import { invalid } from "../errors.ts";
import { backgroundOf, chatUpTo } from "../scene/context.ts";
import { linesOf, numbered, type Line } from "../scene/lines.ts";

export const hashOf = (value: string): string => createHash("sha256").update(value).digest("hex");
export const textOf = (message: Pick<Message, "content">): string => message.content.map(blockText).join("").trim();

/** Added after the tone instructions for a Grok voice, which also makes sounds. */
export const SOUND_NOTE =
  "The voice can also make a sound just before a line: " +
  SOUNDS.join(", ") +
  ". Give a line a sound only where the character would really make one (a sigh before a sad admission, a " +
  "chuckle at their own tease, a breath before something hard to say, a pause for effect); most lines have " +
  "none, so give them null. A few at most in a reply, and never the same one line after line. Don't add a " +
  "sound the words already say: if the reply has them laugh, the line is read as written.";

/** The shape the tone model answers in. */
export const TONE_SCHEMA = {
  type: "object",
  properties: {
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
  required: ["lines"],
  additionalProperties: false,
} as const;

/** The same, with a sound or null for each line. */
export const TONE_SOUND_SCHEMA = {
  ...TONE_SCHEMA,
  properties: {
    lines: {
      type: "array",
      items: {
        ...TONE_SCHEMA.properties.lines.items,
        properties: {
          ...TONE_SCHEMA.properties.lines.items.properties,
          sound: { anyOf: [{ type: "string", enum: [...SOUNDS] }, { type: "null" }] },
        },
        required: ["line", "feeling", "strength", "sound"],
      },
    },
  },
} as const;

export interface ToneRequest {
  provider: Provider;
  model: string;
  effort: Effort;
  system: string;
  /** The profile: the same for every reply of the companion, so it is cached. */
  background: string;
  /** The chat just before the reply, the reply's lines, and what to do. */
  moment: string;
  lines: Line[];
  /** Whether it is for a Grok voice, which also makes sounds. */
  sounds: boolean;
  cacheKey: string;
  /** Of the instructions: other instructions read the reply again. */
  promptHash: string;
  /** Of the reply's own words. */
  textHash: string;
}

/**
 * The request about the reply at the end of `path`, for a voice that makes `sounds` or not. Only a
 * companion's reply has lines.
 */
export function toneRequest(companion: Companion, path: readonly Message[], sounds = false): ToneRequest {
  const message = path.at(-1) ?? invalid("There is no reply to read");
  if (message.role !== "assistant") invalid("Only a companion's replies are read aloud");
  const lines = linesOf(textOf(message));
  if (lines.length === 0) invalid("This reply has nothing to read aloud");
  const system = sounds ? `${promptOf(companion, "tone")}\n\n${SOUND_NOTE}` : promptOf(companion, "tone");
  const { toneModel, toneEffort, toneTokens } = companion.settings;
  return {
    provider: companion.provider,
    model: toneModel,
    effort: toneEffort,
    system,
    background: backgroundOf(companion, { files: [], pins: [] }),
    moment:
      `${chatUpTo(companion, path, toneTokens)}\n\n<lines>\n${numbered(lines)}\n</lines>\n\n` +
      "Say how each numbered line of the reply marked <moment> is said.",
    lines,
    sounds,
    cacheKey: `tone:${companion.id}${sounds ? ":sounds" : ""}`,
    promptHash: hashOf(system),
    textHash: hashOf(textOf(message)),
  };
}
