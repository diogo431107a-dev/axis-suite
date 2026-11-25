// A companion, and the prompt texts it can rewrite.
import type { Settings } from "./models.ts";

/**
 * The texts Valhalla 2 itself adds to what the model reads. Each companion can rewrite any of them;
 * one left out uses the default in shared/prompts.ts.
 */
export const PROMPT_KEYS = [
  "memoryPolicy",
  "pins",
  "greeting",
  "rejection",
  "consolidation",
  "cleanup",
  "scene",
  "picture",
] as const;
export type PromptKey = (typeof PROMPT_KEYS)[number];
export type Prompts = Partial<Record<PromptKey, string>>;

/**
 * Someone you talk to. The profile is one text box you write however you like — XML tags such as
 * <personality> or <user_persona> work well — and it is sent exactly as written.
 */
export interface Companion {
  id: string;
  /** For the list on the page only; the model reads the profile, not this. */
  name: string;
  profile: string;
  settings: Settings;
  prompts: Prompts;
  /** The Azure voice its replies are read aloud in; null for the server's own. */
  voice: string | null;
  createdAt: string;
  updatedAt: string;
}
