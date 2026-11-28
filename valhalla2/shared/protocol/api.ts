// What the server says about itself, and how errors come back.
import type { Settings } from "./models.ts";
import type { PictureEngineId } from "./pictures.ts";

export interface Health {
  /** Whether the server has a Claude API key to send with. */
  apiKey: boolean;
  /** Whether the server has an xAI key, so a companion can answer on Grok. */
  grok: boolean;
  /** Whether the server has an OpenAI key, so a companion can answer on GPT. */
  openai: boolean;
  /** Whether the server can make pictures: it has a CivitAI key, an xAI key, or both. */
  pictures: boolean;
  /** The picture engines it has a key for: CivitAI's, Grok Imagine (on the xAI key). */
  pictureEngines: PictureEngineId[];
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
