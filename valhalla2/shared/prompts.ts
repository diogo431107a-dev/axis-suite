// The words Valhalla 2 adds to what the model reads, besides your profile and the chat itself.
//
// Each companion can rewrite every one of them (its `prompts`); these are what a companion uses
// for the ones it leaves alone, so a better default here reaches every companion that never
// changed it. Inspect shows them in place, exactly as they go out.
import type { Companion, PromptKey } from "./protocol.ts";

export const DEFAULT_PROMPTS: Readonly<Record<PromptKey, string>> = {
  greeting:
    "This is the start of a new chat, and you speak first. Open it in character with a greeting that sets the " +
    "tone for what follows. If something you remember fits naturally (an open thread, where things stand " +
    "between you), you may pick it up. Write only your own words and actions.",
  rejection:
    "Earlier versions of this reply were rejected. The user's reason: {reason}\n" +
    "Write a new version that takes this into account. Never mention this note.",
};

/** What a field of the companion form is called, and what it is for. */
export const PROMPT_LABELS: Readonly<Record<PromptKey, { label: string; hint: string }>> = {
  greeting: {
    label: "Greeting instruction",
    hint: "Hidden from you. Sent once at the start of every chat, so the companion opens it.",
  },
  rejection: {
    label: "Rejection note",
    hint: "Hidden from you. Sent with a new version of a reply after you say why the others didn't work. {reason} is replaced by what you wrote.",
  },
};

/**
 * The first message of every request. The API takes no conversation that starts with the
 * assistant, so the greeting answers this; it is never shown and never changes, so it caches.
 */
export const OPENER = "[The chat begins.]";

/** The text a companion uses for one of Valhalla 2's prompts: its own, or the default. */
export const promptOf = (companion: Pick<Companion, "prompts">, key: PromptKey): string =>
  companion.prompts[key]?.trim() || DEFAULT_PROMPTS[key];

/** The rejection note with the reason filled in. */
export const rejectionNote = (companion: Pick<Companion, "prompts">, reason: string): string =>
  promptOf(companion, "rejection").replaceAll("{reason}", reason.trim());
