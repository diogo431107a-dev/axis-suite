// A companion, and the prompt texts it can rewrite.
import type { Provider, Settings } from "./models.ts";

/**
 * The texts Valhalla 2 itself adds to what the model reads. Each companion can rewrite any of them;
 * one left out uses the default in shared/prompts.ts.
 */
export const PROMPT_KEYS = [
  "memoryPolicy",
  "pins",
  "quiet",
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
  /**
   * The API every request about this companion goes to, chosen once when it is created: a Claude
   * companion can move between Claude models, a Grok one between Grok models, never across.
   */
  provider: Provider;
  /**
   * Whether it has memory, chosen once when it is created; a Grok companion never has. With memory:
   * the memory model, the sliding window, topics to leave alone, the scene, reading with feeling.
   * Without: the whole chat is sent, and pictures and reading aloud work from the message itself.
   * Pins work either way.
   */
  memory: boolean;
  prompts: Prompts;
  /** The Azure voice its replies are read aloud in; null for the server's own. */
  voice: string | null;
  /** Whether its replies are read with the feeling of each line (the scene), or plainly. */
  voiceFeeling: boolean;
  createdAt: string;
  updatedAt: string;
}
