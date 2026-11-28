// A moment of a chat worked out for a picture of it: where and when it happens, who is in it and
// how they look, and the atmosphere. Read once per message, when a picture of it is made, kept, and
// yours to correct. How a reply is said aloud is apart (tone.ts).

/** Someone in the picture, as they are right then. */
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
  /** How that feeling shows in a picture: flushed cheeks, an anger vein, tears, a clenched fist. */
  expression: string;
}

export interface SceneSheet {
  place: string;
  time: string;
  /** The weather, and what it has done. */
  weather: string;
  light: string;
  /** The colours and atmosphere that carry the mood: warm reds, cold blue dusk, soft haze. */
  atmosphere: string;
  /** By default the companion alone; you add anyone else. */
  people: ScenePerson[];
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
