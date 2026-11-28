// A companion, and the prompt texts it can rewrite.
import type { Provider, Settings } from "./models.ts";
import type { VoiceTuning } from "./speech.ts";

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
  "grokPicture",
  "openaiPicture",
  "tone",
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
   * Whether it has memory, chosen when it is created (a Grok companion without can have it turned
   * on later, never off). With memory: the memory model, the sliding window, topics to leave alone,
   * and the scene pictures are drawn from (see hasScenes). Without: the whole chat is sent, and
   * pictures work from the message itself. Pins, and reading aloud with feeling, work either way.
   */
  memory: boolean;
  prompts: Prompts;
  /** The voice its replies are read aloud in (Azure's, or `grok:` and Grok's); null for the server's own. */
  voice: string | null;
  /** Whether its replies are read with the feeling of each line (its tags, tone.ts), or plainly. */
  voiceFeeling: boolean;
  /** Its voice's speed, pitch and speaking style. */
  voiceTuning: VoiceTuning;
  createdAt: string;
  updatedAt: string;
}

/**
 * Whether the companion has scenes: a moment worked out from memory and the chat, which pictures
 * are drawn from. Read on the companion's own API, so a Claude or a Grok companion with memory has
 * them; one without draws its pictures from the message itself.
 */
export const hasScenes = (companion: Pick<Companion, "memory">): boolean => companion.memory;
