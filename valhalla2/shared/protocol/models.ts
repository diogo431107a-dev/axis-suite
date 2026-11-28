// The models, what they cost, and the settings a companion sends with a request.
import type { GrokQuality, GrokResolution, PictureEngineId, Sampler } from "./pictures.ts";

/**
 * How much effort the model puts into a reply. This replaces the temperature slider other
 * companion apps have: the current models reject `temperature`, `top_p` and `top_k` outright.
 * On Haiku, "high" holds a character well and still costs little; a dearer model often needs less.
 */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

/** How long the prompt cache holds the profile and the chat so far. */
export const CACHE_TTLS = ["5m", "1h"] as const;
export type CacheTtl = (typeof CACHE_TTLS)[number];

/**
 * Which API answers a model: Anthropic's for Claude, xAI's for Grok, OpenAI's for GPT. Told by the
 * id alone, so a model typed in by hand needs nothing more. A companion is on one of them, and
 * everything it asks goes to its own API: chat replies, its memory model, picture prompts, its
 * scenes and the tags its replies are read aloud with.
 */
export const PROVIDERS = ["anthropic", "xai", "openai"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const providerOf = (model: string): Provider =>
  model.startsWith("grok-") ? "xai" : model.startsWith("gpt-") ? "openai" : "anthropic";

/** What each API's models are called on the page. */
export const PROVIDER_NAMES: Readonly<Record<Provider, string>> = { anthropic: "Claude", xai: "Grok", openai: "GPT" };

/**
 * The models offered in the picker, with what they cost per million tokens. Any other model id
 * can be typed in by hand — Valhalla 2 sends what you choose and does not second-guess it.
 * Claude prices as published on 2026-11-03, Grok's on 2026-11-25, OpenAI's on 2026-11-28.
 */
export const MODELS = [
  { id: "claude-opus-5-5", label: "Opus 5.5", input: 4.0, output: 20.0, cacheRead: 0.2, provider: "anthropic" },
  { id: "claude-fable-5-2", label: "Fable 5.2", input: 8.0, output: 40.0, cacheRead: 0.2, provider: "anthropic" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", input: 2.0, output: 10.0, cacheRead: 0.1, provider: "anthropic" },
  // Haiku has two rates: these, and five times as much for a prompt over 100K tokens (see PRICES).
  { id: "claude-haiku-5-5", label: "Haiku 5.5", input: 0.1, output: 0.5, cacheRead: 0.01, provider: "anthropic" },
  // Grok has two rates too: these, and twice as much for a prompt of 200K tokens or more.
  { id: "grok-4.7", label: "Grok 4.7", input: 2.0, output: 6.0, cacheRead: 0.5, provider: "xai" },
  // GPT has two rates as well: these, and dearer ones for a prompt over 272K tokens.
  { id: "gpt-6-luna", label: "GPT-6 Luna", input: 0.1, output: 0.5, cacheRead: 0.01, provider: "openai" },
] as const satisfies readonly {
  id: string;
  label: string;
  input: number;
  output: number;
  cacheRead: number;
  provider: Provider;
}[];

/**
 * Whether the API can hand a declined turn to another model. Claude's has no fallback for Haiku,
 * and xAI's and OpenAI's have none at all.
 */
export const hasFallback = (model: string): boolean =>
  providerOf(model) === "anthropic" && !model.startsWith("claude-haiku-");

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
  "grok-4.7": {
    input: 2.0,
    output: 6.0,
    cacheRead: 0.5,
    long: { over: 199_999, input: 4.0, output: 12.0, cacheRead: 1.0 },
  },
  "gpt-6-luna": {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    long: { over: 272_000, input: 0.2, output: 0.75, cacheRead: 0.02 },
  },
  "claude-opus-5": { input: 5.0, output: 25.0, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5.0, output: 25.0, cacheRead: 0.5 },
  "claude-sonnet-5": { input: 2.0, output: 10.0, cacheRead: 0.2 },
};

/**
 * What a new companion starts from when the server names no models of its own. The server's
 * CHAT_MODEL and MEMORY_MODEL replace the two models; /api/health hands the result to the page.
 *
 * The economical choice: Haiku at high effort answers in character well for a fraction of what
 * Sonnet or Opus cost. Memory stays on Sonnet, which keeps it more carefully.
 */
export const DEFAULT_SETTINGS: Settings = {
  model: "claude-haiku-5-5",
  memoryModel: "claude-sonnet-5-5",
  maxTokens: 4096,
  effort: "high",
  stopSequences: [],
  cacheTtl: "1h",
  fallbacks: true,
  temperature: null,
  toneModel: "claude-haiku-5-5",
  toneEffort: "low",
  toneTokens: 4_000,
  sceneModel: "claude-haiku-5-5",
  sceneEffort: "low",
  pictureSteps: 20,
  pictureCfg: 7,
  pictureSampler: "euler_a",
  pictureClipSkip: 2,
  pictureSeed: null,
  pictureEngine: "civitai",
  grokPictureQuality: "auto",
  grokPictureResolution: "1k",
};

/**
 * The tag and scene settings a Grok or GPT companion starts with: its own chat model, at low
 * effort. (A Claude companion's are the server's TONE_MODEL and SCENE_MODEL.)
 */
export const ownReadingDefaults = (
  model: string,
): Pick<Settings, "toneModel" | "toneEffort" | "sceneModel" | "sceneEffort"> => ({
  toneModel: model,
  toneEffort: "low",
  sceneModel: model,
  sceneEffort: "low",
});

/** What Valhalla 2 sends with a request, besides the profile. One set per companion. */
export interface Settings {
  /** The model that answers in character. */
  model: string;
  /** The model that keeps the companion's memory up to date after a chat. Used only with memory. */
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
  /**
   * Grok only: how freely it picks its words, from 0 to 1. Null sends none, and Grok uses its own
   * default. Claude's and GPT's models reject a temperature, so their companions' is always null.
   */
  temperature: number | null;
  /**
   * The model that works out how each line of a reply is said when it is read aloud with feeling,
   * and its effort. On the companion's own API.
   */
  toneModel: string;
  toneEffort: Effort;
  /** About how many tokens of the chat before a reply the tone model reads. */
  toneTokens: number;
  /** The model that works out a moment for a picture of it (with memory only), and its effort. */
  sceneModel: string;
  sceneEffort: Effort;
  /** How many steps CivitAI takes over a picture: more is finer, slower and dearer. */
  pictureSteps: number;
  /** How closely the picture follows its prompt (CFG): higher is more literal, lower freer. */
  pictureCfg: number;
  /** How CivitAI's sampler steps from noise to picture. One of SAMPLERS. */
  pictureSampler: Sampler;
  /** How many of the text encoder's last layers are skipped: 2 suits anime checkpoints. */
  pictureClipSkip: number;
  /**
   * The seed the next picture starts from, so pictures carry on alike. Null until the first
   * picture, which rolls one; whatever seed a picture is made with becomes this.
   */
  pictureSeed: number | null;
  /**
   * What makes its pictures. One the server has no key for gives way to the other (pictureEngineOf).
   */
  pictureEngine: PictureEngineId;
  /** Grok Imagine's quality and size for its pictures. */
  grokPictureQuality: GrokQuality;
  grokPictureResolution: GrokResolution;
}
