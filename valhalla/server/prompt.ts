// Turning a character and a persona into the system prompt.
//
// Valhalla contributes the headings and nothing else — no instruction, no framing, no reminder of
// what the model may or may not write. Every word the model reads about who it is came from you.
// If you want it to stay in character rather than describe one, write that in Behavior; the form
// starts a new character off with a line to that effect, which you can change or delete.
//
// Two rules hold this file together, both about the prompt cache. The API matches a cached prefix
// byte for byte, so (1) the same character and persona must always produce exactly the same text
// — no dates, no ids, nothing that differs between two requests — and (2) the breakpoint goes on
// the last block, which caches the character and the persona together. On Claude Opus 5.5 that
// turns $4.00 per million input tokens into $0.20 for everything already said.
import type { CacheTtl, Character, Persona, PromptView, Settings } from "../shared/protocol.ts";

export interface SystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral"; ttl: CacheTtl };
}

/** A heading and its text, left out when there is no text. Drops the trailing blank line. */
const section = (heading: string, body: string): string => (body ? `## ${heading}\n${body}\n\n` : "");

const characterText = (character: Character): string =>
  `# ${character.name}\n\n` +
  section("Personality", character.personality) +
  section("Appearance", character.appearance) +
  section("Behavior", character.behavior);

const personaText = (persona: Persona): string =>
  `# Speaking with you: ${persona.name}\n\n` +
  section("Who they are", persona.description) +
  section("Appearance", persona.appearance);

/**
 * The system prompt for a conversation: the character, then the persona, with the cache
 * breakpoint on the last block.
 *
 * Deterministic in its inputs. A section is left out when its field is empty, which is still
 * deterministic — the prefix changes only when you change the definition, and then it should.
 */
export function buildSystem(character: Character, persona: Persona, settings: Settings): SystemBlock[] {
  return [
    { type: "text", text: characterText(character).trimEnd() },
    {
      type: "text",
      text: personaText(persona).trimEnd(),
      cache_control: { type: "ephemeral", ttl: settings.cacheTtl },
    },
  ];
}

/** The request as it will be sent, for the Inspect panel. Nothing is assembled out of your sight. */
export function promptView(character: Character, persona: Persona, settings: Settings, turns: number): PromptView {
  return { system: buildSystem(character, persona, settings), settings, turns };
}
