// What the tone model is asked about one reply: the companion's profile, the chat just before it
// (about `toneTokens` of it), and the reply as numbered lines. No memory: how a line is said
// depends on who says it and what came just before, and the reading is kept cheap.
import { createHash } from "node:crypto";
import {
  blockText,
  FEELINGS,
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
  cacheKey: string;
  /** Of the instructions: other instructions read the reply again. */
  promptHash: string;
  /** Of the reply's own words. */
  textHash: string;
}

/** The request about the reply at the end of `path`. Only a companion's reply has lines. */
export function toneRequest(companion: Companion, path: readonly Message[]): ToneRequest {
  const message = path.at(-1) ?? invalid("There is no reply to read");
  if (message.role !== "assistant") invalid("Only a companion's replies are read aloud");
  const lines = linesOf(textOf(message));
  if (lines.length === 0) invalid("This reply has nothing to read aloud");
  const system = promptOf(companion, "tone");
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
    cacheKey: `tone:${companion.id}`,
    promptHash: hashOf(system),
    textHash: hashOf(textOf(message)),
  };
}
