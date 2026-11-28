// What the server says about itself, and how errors come back.
import type { Settings } from "./models.ts";

export interface Health {
  /** Whether the server has a Claude API key to send with. */
  apiKey: boolean;
  /** Whether the server has an xAI key, so a companion can answer on Grok. */
  grok: boolean;
  /** Whether the server has a CivitAI key, so pictures can be made. */
  pictures: boolean;
  /** Whether the server has an Azure Speech key or an xAI key, so replies can be read aloud. */
  speech: boolean;
  /** The voice a companion that names none of its own is read in; null when nothing reads aloud. */
  voice: string | null;
  /** What a new companion starts from. */
  defaults: Settings;
}

export const ERROR_CODES = ["invalid", "not-found", "conflict", "too-many", "no-credential", "api", "busy"] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  error: string;
  code?: ErrorCode;
}
