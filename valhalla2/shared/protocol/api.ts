// What the server says about itself, a reply read aloud, and how errors come back.
import type { Settings } from "./models.ts";

export interface Health {
  /** Whether the server has a Claude API key to send with. */
  apiKey: boolean;
  /** Whether the server has a CivitAI key, so pictures can be made. */
  pictures: boolean;
  /** Whether the server has an Azure Speech key, so replies can be read aloud. */
  speech: boolean;
  /** What a new companion starts from. */
  defaults: Settings;
}

/** A reply read aloud: where its audio is, and how much Azure has read this month. */
export interface SpeechReply {
  url: string;
  /** Characters Azure was asked to read this calendar month (UTC), by everyone on this server. */
  monthChars: number;
}

export const ERROR_CODES = ["invalid", "not-found", "conflict", "too-many", "no-credential", "api", "busy"] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  error: string;
  code?: ErrorCode;
}
