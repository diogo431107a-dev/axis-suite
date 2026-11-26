// A picture's prompt as a model writes it: the shape it answers in, and reading the answer. The same
// for Claude (../claude/pictures.ts) and Grok (../grok/pictures.ts).
import { LIMITS, ORIENTATIONS, type Orientation, type PictureDraft } from "../../shared/protocol.ts";
import { StoreError } from "../errors.ts";

/** The shape the model answers in when it writes a picture's prompt. */
export const PICTURE_SCHEMA = {
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

/** Reads the answer as a picture's draft, or says what was wrong with it. `who` names the model's maker. */
export function draftOf(text: string, who = "Claude"): PictureDraft {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new StoreError(502, `${who}'s answer wasn't a picture prompt. Try again.`, "api");
  }
  const fields = (raw ?? {}) as Record<string, unknown>;
  const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  const prompt = str(fields.prompt, LIMITS.picturePrompt);
  if (!prompt) throw new StoreError(502, `${who} wrote an empty picture prompt. Try again.`, "api");
  return {
    prompt,
    negativePrompt: str(fields.negativePrompt, LIMITS.picturePrompt),
    orientation: ORIENTATIONS.includes(fields.orientation as Orientation)
      ? (fields.orientation as Orientation)
      : "portrait",
    caption: str(fields.caption, LIMITS.pictureCaption),
  };
}
