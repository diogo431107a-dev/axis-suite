// The models, what they cost, and the settings a companion sends with a request.

/**
 * How much effort the model puts into a reply. This replaces the temperature slider other
 * companion apps have: the current models reject `temperature`, `top_p` and `top_k` outright.
 * Dialogue usually wants "low" — it answers sooner and stays in voice.
 */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

/** How long the prompt cache holds the profile and the chat so far. */
export const CACHE_TTLS = ["5m", "1h"] as const;
export type CacheTtl = (typeof CACHE_TTLS)[number];

/**
 * The models offered in the picker, with what they cost per million tokens. Any other model id
 * can be typed in by hand — Valhalla 2 sends what you choose and does not second-guess it.
 * Prices as published on 2026-11-03.
 */
export const MODELS = [
  { id: "claude-opus-5-5", label: "Opus 5.5", input: 4.0, output: 20.0, cacheRead: 0.2 },
  { id: "claude-fable-5-2", label: "Fable 5.2", input: 8.0, output: 40.0, cacheRead: 0.2 },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", input: 2.0, output: 10.0, cacheRead: 0.1 },
  // Haiku has two rates: these, and five times as much for a prompt over 100K tokens (see PRICES).
  { id: "claude-haiku-5-5", label: "Haiku 5.5", input: 0.1, output: 0.5, cacheRead: 0.01 },
] as const;

/** Whether the API can hand a declined turn to another model. It has no fallback for Haiku. */
export const hasFallback = (model: string): boolean => !model.startsWith("claude-haiku-");

export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  /** A dearer rate for a prompt longer than `over` tokens. */
  long?: { over: number; input: number; output: number; cacheRead: number };
}

/**
 * What every model a turn can come from costs, per million tokens: the ones in the picker, and
 * the older ones the API may hand a declined turn to. Prices as published on 2026-11-03.
 */
export const PRICES: Readonly<Record<string, Price>> = {
  ...Object.fromEntries(MODELS.map(({ id, input, output, cacheRead }) => [id, { input, output, cacheRead }])),
  "claude-haiku-5-5": {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    long: { over: 100_000, input: 0.5, output: 2.5, cacheRead: 0.05 },
  },
  "claude-opus-5": { input: 5.0, output: 25.0, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5.0, output: 25.0, cacheRead: 0.5 },
  "claude-sonnet-5": { input: 2.0, output: 10.0, cacheRead: 0.2 },
};

/**
 * What a new companion starts from when the server names no models of its own. The server's
 * CHAT_MODEL and MEMORY_MODEL replace the two models; /api/health hands the result to the page.
 */
export const DEFAULT_SETTINGS: Settings = {
  model: "claude-opus-5-5",
  memoryModel: "claude-sonnet-5-5",
  maxTokens: 4096,
  effort: "low",
  stopSequences: [],
  cacheTtl: "1h",
  fallbacks: true,
};

/** What Valhalla 2 sends with a request, besides the profile. One set per companion. */
export interface Settings {
  /** The model that answers in character. */
  model: string;
  /** The model that keeps the companion's memory up to date after a chat. */
  memoryModel: string;
  maxTokens: number;
  effort: Effort;
  /** Text that ends a reply early — useful to stop the model writing your lines for you. */
  stopSequences: string[];
  cacheTtl: CacheTtl;
  /**
   * Whether the API may answer on a fallback model when a safety classifier declines this one.
   * Valhalla 2 adds no filter of its own either way; this only decides whether a declined turn
   * gets a second chance inside the same call.
   */
  fallbacks: boolean;
}
