// Checking what comes in, before anything is written.
import {
  CACHE_TTLS,
  DEFAULT_SETTINGS,
  DEFAULT_TUNING,
  EFFORTS,
  GROK_QUALITIES,
  GROK_RESOLUTIONS,
  LIMITS,
  PICTURE_ENGINES,
  PROMPT_KEYS,
  providerOf,
  SAMPLER_IDS,
  type Sampler,
  type CacheTtl,
  type GrokQuality,
  type GrokResolution,
  type PictureEngineId,
  type Provider,
  type Effort,
  type Prompts,
  type Settings,
  type VoiceTuning,
} from "../shared/protocol.ts";
import { invalid } from "./errors.ts";

export const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid("That request isn't valid");

/** Text with its outer spaces trimmed, up to `max` characters. */
export function text(value: unknown, max: number, what: string): string {
  if (typeof value !== "string") invalid(`${what} isn't valid`);
  const trimmed = value.trim();
  if (trimmed.length > max) invalid(`${what} is too long: ${max} characters at most`);
  return trimmed;
}

export function required(value: unknown, max: number, what: string): string {
  return text(value, max, what) || invalid(`${what} can't be empty`);
}

export function oneOf<T extends string>(value: unknown, options: readonly T[], what: string): T {
  return options.includes(value as T) ? (value as T) : invalid(`${what} isn't valid`);
}

/** An id made by the page: letters, digits and dashes. */
export function id(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(value)) invalid("That id isn't valid");
  return value;
}

export function whole(value: unknown, min: number, max: number, what: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) invalid(`${what} has to be a whole number`);
  if (value < min || value > max) invalid(`${what} has to be between ${min} and ${max}`);
  return value;
}

/**
 * A model id. Anything the API accepts is allowed, not only the names in the picker: choosing the
 * model is yours to make, and Valhalla 2 has no business narrowing it.
 */
export function model(value: unknown): string {
  const name = required(value, 120, "The model");
  if (!/^[A-Za-z0-9._@-]+$/.test(name)) invalid("That model id isn't valid");
  return name;
}

/**
 * A temperature for a Grok companion: from 0 to 1 in steps of 0.05, or null for Grok's own default.
 * Grok samples at most at 1, so nothing above it is offered. Claude's models take none at all.
 */
export function temperature(value: unknown, provider: Provider): number | null {
  if (value === undefined || value === null) return null;
  if (provider !== "xai") invalid("Claude's models don't take a temperature");
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    invalid("The temperature has to be between 0 and 1");
  }
  return Math.round(value * 20) / 20;
}

export function stopSequences(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) invalid("The stop sequences aren't valid");
  const items = value.map((item) => text(item, LIMITS.stopSequence, "A stop sequence")).filter(Boolean);
  if (items.length > LIMITS.stopSequences) invalid(`${LIMITS.stopSequences} stop sequences at most`);
  return items;
}

/** A message id from the page: a positive whole number. */
export function messageId(value: unknown): number {
  const n = typeof value === "string" && /^[0-9]{1,15}$/.test(value) ? Number(value) : value;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1) invalid("That message id isn't valid");
  return n;
}

/**
 * A voice name (Azure's, or `grok:` and Grok's), or null (nothing chosen: the server's voice). Like
 * a model id, any name is taken, not only those in the list: the engine says whether it knows it
 * when it is asked to read.
 */
export function voice(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const name = required(value, LIMITS.voice, "The voice");
  if (!/^[A-Za-z0-9:_-]+$/.test(name)) invalid("That voice name isn't valid");
  return name;
}

/**
 * A voice's speed, pitch and speaking style, each left out meaning the voice's usual. Whether the
 * voice has the style is found out when it reads: one it hasn't is left out then.
 */
export function voiceTuning(value: unknown): VoiceTuning {
  if (value === undefined || value === null) return DEFAULT_TUNING;
  const fields = object(value);
  const rate =
    fields.rate === undefined ? 0 : whole(fields.rate, LIMITS.voiceRateMin, LIMITS.voiceRateMax, "The speed");
  const pitch =
    fields.pitch === undefined ? 0 : whole(fields.pitch, LIMITS.voicePitchMin, LIMITS.voicePitchMax, "The pitch");
  let style: string | null = null;
  if (fields.style !== undefined && fields.style !== null && fields.style !== "") {
    if (typeof fields.style !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(fields.style)) {
      invalid("That speaking style isn't valid");
    }
    style = fields.style;
  }
  return { rate, pitch, style };
}

/** A row id from a URL (a memory version, a pin): a positive whole number. */
export function rowId(value: unknown, what: string): number {
  const n = typeof value === "string" && /^[0-9]{1,15}$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : invalid(`${what} isn't valid`);
}

/**
 * Settings from the page, anything left out taken from `defaults`. Both models are on the same API.
 * A Grok companion's memory model is a Grok model: the one it names, or else its chat model (the
 * defaults name a Claude one, and a Grok companion may have been saved before it had memory).
 */
export function settings(value: unknown, defaults: Settings = DEFAULT_SETTINGS): Settings {
  if (value === undefined || value === null) return { ...defaults };
  const body = object(value);
  const chatModel = model(body.model ?? defaults.model);
  const provider = providerOf(chatModel);
  /**
   * A model besides the chat model (memory, tone, scene). On Grok, one left out or not Grok's is
   * the chat model; on Claude, one left out is the server's default, and Grok's is refused.
   */
  const helper = (value: unknown, fallback: string, what: string): string => {
    const asked = value === undefined ? undefined : model(value);
    const chosen =
      provider === "xai"
        ? asked !== undefined && providerOf(asked) === "xai"
          ? asked
          : chatModel
        : (asked ?? model(fallback));
    if (providerOf(chosen) !== provider) invalid(`The ${what} has to be a Claude model`);
    return chosen;
  };
  const effort = (value: unknown, fallback: Effort, what: string): Effort =>
    oneOf<Effort>(value ?? fallback, EFFORTS, what);
  return {
    model: chatModel,
    memoryModel: helper(body.memoryModel, defaults.memoryModel, "memory model"),
    maxTokens: whole(body.maxTokens ?? defaults.maxTokens, LIMITS.minTokens, LIMITS.maxTokens, "Reply length"),
    effort: effort(body.effort, defaults.effort, "The effort"),
    stopSequences: stopSequences(body.stopSequences),
    cacheTtl: oneOf<CacheTtl>(body.cacheTtl ?? defaults.cacheTtl, CACHE_TTLS, "The cache setting"),
    fallbacks: body.fallbacks === undefined ? defaults.fallbacks : body.fallbacks === true,
    temperature: temperature(body.temperature, provider),
    toneModel: helper(body.toneModel, defaults.toneModel, "tone model"),
    toneEffort: effort(body.toneEffort, defaults.toneEffort, "The tone effort"),
    toneTokens: whole(
      body.toneTokens ?? defaults.toneTokens,
      LIMITS.minToneTokens,
      LIMITS.maxToneTokens,
      "How much of the chat the tone model reads",
    ),
    sceneModel: helper(body.sceneModel, defaults.sceneModel, "scene model"),
    sceneEffort: effort(body.sceneEffort, defaults.sceneEffort, "The scene effort"),
    pictureSteps: whole(
      body.pictureSteps ?? defaults.pictureSteps,
      LIMITS.pictureStepsMin,
      LIMITS.pictureStepsMax,
      "The picture steps",
    ),
    pictureCfg: halves(body.pictureCfg ?? defaults.pictureCfg, LIMITS.pictureCfgMin, LIMITS.pictureCfgMax, "The CFG"),
    pictureSampler: oneOf<Sampler>(body.pictureSampler ?? defaults.pictureSampler, SAMPLER_IDS, "The sampler"),
    pictureClipSkip: whole(
      body.pictureClipSkip ?? defaults.pictureClipSkip,
      LIMITS.pictureClipSkipMin,
      LIMITS.pictureClipSkipMax,
      "The clip skip",
    ),
    pictureSeed: body.pictureSeed === undefined ? defaults.pictureSeed : seed(body.pictureSeed),
    pictureEngine: oneOf<PictureEngineId>(
      body.pictureEngine ?? defaults.pictureEngine,
      PICTURE_ENGINES,
      "The picture engine",
    ),
    grokPictureQuality: oneOf<GrokQuality>(
      body.grokPictureQuality ?? defaults.grokPictureQuality,
      GROK_QUALITIES,
      "The picture quality",
    ),
    grokPictureResolution: oneOf<GrokResolution>(
      body.grokPictureResolution ?? defaults.grokPictureResolution,
      GROK_RESOLUTIONS,
      "The picture size",
    ),
  };
}

/** A number from `min` to `max` in steps of a half, such as a CFG of 6.5. */
export function halves(value: unknown, min: number, max: number, what: string): number {
  if (typeof value !== "number" || !Number.isInteger(value * 2)) invalid(`${what} has to be a whole or half number`);
  if (value < min || value > max) invalid(`${what} has to be between ${min} and ${max}`);
  return value;
}

/** A picture's seed: a whole number of up to ten digits, or null for one rolled at the next picture. */
export function seed(value: unknown): number | null {
  if (value === null) return null;
  return whole(value, 0, LIMITS.pictureSeedMax, "The seed");
}

/** A companion's own prompt texts. An empty one is left out, so the default is used. */
export function prompts(value: unknown): Prompts {
  if (value === undefined || value === null) return {};
  const body = object(value);
  const kept: Prompts = {};
  for (const key of PROMPT_KEYS) {
    if (body[key] === undefined || body[key] === null) continue;
    const written = text(body[key], LIMITS.prompt, "A prompt text");
    if (written) kept[key] = written;
  }
  return kept;
}
