// Checking what comes in, before anything is written.
import {
  CACHE_TTLS,
  DEFAULT_SETTINGS,
  DEFAULT_TUNING,
  EFFORTS,
  LIMITS,
  PROMPT_KEYS,
  providerOf,
  type CacheTtl,
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
 * An Azure voice name, or null (nothing chosen: the server's voice). Like a model id, any name is
 * taken, not only those in the list: Azure says whether it knows it when it is asked to read.
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
  const asked = body.memoryModel === undefined ? undefined : model(body.memoryModel);
  const memory =
    provider === "xai"
      ? asked !== undefined && providerOf(asked) === "xai"
        ? asked
        : chatModel
      : (asked ?? model(defaults.memoryModel));
  if (providerOf(memory) !== provider) invalid("The memory model has to be a Claude model");
  return {
    model: chatModel,
    memoryModel: memory,
    maxTokens: whole(body.maxTokens ?? defaults.maxTokens, LIMITS.minTokens, LIMITS.maxTokens, "Reply length"),
    effort: oneOf<Effort>(body.effort ?? defaults.effort, EFFORTS, "The effort"),
    stopSequences: stopSequences(body.stopSequences),
    cacheTtl: oneOf<CacheTtl>(body.cacheTtl ?? defaults.cacheTtl, CACHE_TTLS, "The cache setting"),
    fallbacks: body.fallbacks === undefined ? defaults.fallbacks : body.fallbacks === true,
    temperature: temperature(body.temperature, provider),
  };
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
