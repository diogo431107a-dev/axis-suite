// Checking what comes in, before anything is written.
import {
  CACHE_TTLS,
  DEFAULT_SETTINGS,
  EFFORTS,
  LIMITS,
  type CacheTtl,
  type Effort,
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

/** An id made by the page. Also the name of a file on disk, so nothing but letters and dashes. */
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
 * model is yours to make, and Valhalla has no business narrowing it.
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

export function settings(value: unknown): Settings {
  if (value === undefined || value === null) return { ...DEFAULT_SETTINGS };
  const body = object(value);
  return {
    model: model(body.model ?? DEFAULT_SETTINGS.model),
    maxTokens: whole(body.maxTokens ?? DEFAULT_SETTINGS.maxTokens, LIMITS.minTokens, LIMITS.maxTokens, "Reply length"),
    effort: oneOf<Effort>(body.effort ?? DEFAULT_SETTINGS.effort, EFFORTS, "The effort"),
    stopSequences: stopSequences(body.stopSequences),
    cacheTtl: oneOf<CacheTtl>(body.cacheTtl ?? DEFAULT_SETTINGS.cacheTtl, CACHE_TTLS, "The cache setting"),
    fallbacks: body.fallbacks === undefined ? DEFAULT_SETTINGS.fallbacks : body.fallbacks === true,
  };
}
