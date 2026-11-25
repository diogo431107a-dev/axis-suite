// A moment of a chat worked out: where and when it happens, who is there and how, and how each line
// of a reply is said. Read once per message (when a picture of it is made, or it is read aloud),
// kept, and yours to correct.

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

/** One line of a reply, as Valhalla 2 cut it, and how it is said. */
export interface SceneLine {
  /** The words, exactly as in the reply, without the asterisks. */
  text: string;
  /** An action or the setting, set in asterisks; otherwise speech. */
  action: boolean;
  /** The first line of a paragraph. */
  paragraph: boolean;
  feeling: Feeling;
  strength: Strength;
}

/** Someone present at the moment, as they are right then. */
export interface ScenePerson {
  name: string;
  /** Their look now: hair, build, anything changed. */
  appearance: string;
  /** What they wear, and its state: soaked, torn, half-buttoned. */
  clothes: string;
  /** What they are doing, and where. */
  action: string;
  /** How they feel and what they mean, with a few words of why. */
  mood: string;
}

export interface SceneSheet {
  place: string;
  time: string;
  /** The weather, and what it has done. */
  weather: string;
  light: string;
  people: ScenePerson[];
  /** A companion's reply, line by line; empty for one of your messages. */
  lines: SceneLine[];
}

/** A kept reading of a moment, with what it cost and the request that made it. */
export interface SceneView {
  messageId: number;
  sheet: SceneSheet;
  /** You corrected it: it stays as you left it until the message's own words change. */
  edited: boolean;
  model: string;
  /** In dollars, at the published prices; null when a price is unknown. */
  cost: number | null;
  /** Exactly what was sent. */
  request: { system: string; prompt: string };
  createdAt: string;
}
