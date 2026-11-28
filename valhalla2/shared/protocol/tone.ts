// How each line of a reply is said, for reading it aloud: the tags a voice reads it with. Worked out
// the first time a reply is read aloud with feeling, kept, and yours to correct. Apart from the
// scene (scene.ts), which is for pictures.
import type { Effort } from "./models.ts";

/** How a line is said. "narration" is the voice of an action or the setting, set in asterisks. */
export const FEELINGS = [
  "neutral",
  "narration",
  "warm",
  "cheerful",
  "excited",
  "playful",
  "teasing",
  "sarcastic",
  "tender",
  "shy",
  "embarrassed",
  "sad",
  "hurt",
  "angry",
  "cold",
  "fearful",
  "whispering",
  "shouting",
  "serious",
  "calm",
] as const;
export type Feeling = (typeof FEELINGS)[number];

/** How strongly: 1 slight, 2 clear, 3 strong. */
export const STRENGTHS = [1, 2, 3] as const;
export type Strength = (typeof STRENGTHS)[number];

/**
 * A sound said before a line that isn't a word: a sigh, a laugh, a breath, a pause. Only Grok's
 * voices make them (as `[sigh]`); Azure's read the line without it.
 */
export const SOUNDS = [
  "pause",
  "long-pause",
  "hum-tune",
  "laugh",
  "chuckle",
  "giggle",
  "cry",
  "tsk",
  "tongue-click",
  "lip-smack",
  "breath",
  "inhale",
  "exhale",
  "sigh",
] as const;
export type Sound = (typeof SOUNDS)[number];

/** One line of a reply, as Valhalla 2 cut it, and how it is said. */
export interface ToneLine {
  /** The words, exactly as in the reply, without the asterisks. */
  text: string;
  /** An action or the setting, set in asterisks; otherwise speech. */
  action: boolean;
  /** The first line of a paragraph. */
  paragraph: boolean;
  feeling: Feeling;
  strength: Strength;
  /** A sound just before it, for Grok's voices; null or left out for none (tags read before sounds). */
  sound?: Sound | null;
}

/** A kept reading of how a reply is said, with what it cost and the request that made it. */
export interface ToneView {
  messageId: number;
  lines: ToneLine[];
  /** Whether it was read for a Grok voice, which also makes sounds, so they can be chosen. */
  sounds: boolean;
  /** You corrected it: it stays as you left it until the reply's own words change. */
  edited: boolean;
  model: string;
  effort: Effort;
  /** In dollars, at the published prices; null when a price is unknown. */
  cost: number | null;
  /** Exactly what was sent. */
  request: { system: string; prompt: string };
  createdAt: string;
}

/** The replies of a chat whose lines have been read, so their tags can be looked at. */
export interface ToneList {
  messageIds: number[];
}
