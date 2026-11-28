// What makes a picture: CivitAI today, and later Grok's or OpenAI's image models.
//
// The painter (painter.ts) asks for a picture, keeps the engine's id for the job so a picture the
// server stopped in the middle of can be picked up again, waits, and downloads it. An engine only
// does those three things, each its own way. What differs most between engines is the prompt:
// CivitAI's SDXL checkpoints read Danbooru tags (the "picture" instructions in shared/prompts.ts),
// Grok's and OpenAI's image models read plain sentences, which will have instructions of their own.
import type { PictureParams } from "../../shared/protocol.ts";

/** How an engine's prompts are written: Danbooru tags, or plain sentences. */
export type PromptStyle = "tags" | "natural";

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

export interface PictureEngine {
  /** Kept with each picture, so one asked of another engine is never looked for here. */
  readonly id: string;
  readonly promptStyle: PromptStyle;
  /** Asks for a picture. The job may already be done when it answers. */
  submit(order: PictureOrder): Promise<EngineJob>;
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
