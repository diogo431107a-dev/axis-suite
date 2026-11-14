// Checking what comes in, before anything is written.
import {
  CACHE_TTLS,
  DEFAULT_SETTINGS,
  EFFORTS,
  LIMITS,
  PROMPT_KEYS,
  type CacheTtl,
  type Effort,
  type Prompts,
  type Settings,
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

/** Settings from the page, anything left out taken from `defaults`. */
export function settings(value: unknown, defaults: Settings = DEFAULT_SETTINGS): Settings {
  if (value === undefined || value === null) return { ...defaults };
  const body = object(value);
  return {
    model: model(body.model ?? defaults.model),
    memoryModel: model(body.memoryModel ?? defaults.memoryModel),
    maxTokens: whole(body.maxTokens ?? defaults.maxTokens, LIMITS.minTokens, LIMITS.maxTokens, "Reply length"),
    effort: oneOf<Effort>(body.effort ?? defaults.effort, EFFORTS, "The effort"),
    stopSequences: stopSequences(body.stopSequences),
    cacheTtl: oneOf<CacheTtl>(body.cacheTtl ?? defaults.cacheTtl, CACHE_TTLS, "The cache setting"),
    fallbacks: body.fallbacks === undefined ? defaults.fallbacks : body.fallbacks === true,
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
