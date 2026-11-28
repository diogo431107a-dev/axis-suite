// What makes a picture: CivitAI, Grok Imagine (xAI's image model) or OpenAI's image model.
//
// The painter (painter.ts) asks for a picture and keeps it. An engine either answers with a job to
// wait for (CivitAI: its id is kept so a picture the server stopped in the middle of can be picked
// up again, then the painter waits and downloads it), or with the picture itself (Grok Imagine,
// which makes it within the one request, as OpenAI's does). What differs most between engines is the prompt, and
// each engine says which of the companion's picture instructions write it (shared/prompts.ts):
// CivitAI's SDXL checkpoints read Danbooru tags ("picture"), Grok Imagine and OpenAI plain
// sentences ("grokPicture", "openaiPicture").
import type { PictureEngineId, PictureParams, PromptKey } from "../../shared/protocol.ts";

/** The companion's instructions an engine's prompts are written from. */
export type PicturePrompt = Extract<PromptKey, "picture" | "grokPicture" | "openaiPicture">;

/** One picture to make, as it is kept: its prompt and what it is made with. */
export interface PictureOrder {
  prompt: string;
  negativePrompt: string;
  params: PictureParams;
}

/** The engine's own job for a picture: its id, kept so the picture can be picked up again. */
export interface EngineJob {
  id: string;
}

/** A finished picture's bytes, and what it cost when the engine says (in dollars). */
export interface MadeImage {
  bytes: Uint8Array;
  type: string;
  ext: string;
  cost: number | null;
}

export interface PictureEngine {
  /** Kept with each picture, so one asked of another engine is never looked for here. */
  readonly id: PictureEngineId;
  /** Which of the companion's picture instructions write this engine's prompts. */
  readonly promptKey: PicturePrompt;
  /** Whether it takes a negative prompt and a seed. Only CivitAI does. */
  readonly takesNegative: boolean;
  /** Asks for a picture: a job to wait for, or the picture itself. A job may already be done. */
  submit(order: PictureOrder): Promise<{ job: EngineJob } | { image: MadeImage }>;
  /** Waits for a job (or the job with this id) to finish, and returns its image's address. */
  finish(job: EngineJob | string): Promise<string>;
  /** Downloads a finished image, refusing anything that isn't one. */
  download(url: string): Promise<{ bytes: Uint8Array; type: string; ext: string }>;
}

/**
 * The engine's errors whose words can be shown as they are: a refused key, a refused prompt, a
 * picture that took too long. Anything else is logged, and the picture says something went wrong.
 */
export class EngineError extends Error {}
