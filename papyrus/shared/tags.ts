// #tags, as people type them in a page: #travel, #família, #work/meetings, #well-being.
import { LIMITS } from "./protocol.ts";

// Web addresses go first, so "example.com/#section" isn't a tag.
const WEB_ADDRESS = /(?:https?:\/\/|www\.)\S+/giu;
// A # that doesn't follow a letter, digit, &, # or / ("C#", "issue#4", "&#123;", "a/#b" aren't
// tags), then letters, digits and _, with - or / between them. A "." ends a tag, so "#tired." is
// "tired".
const TAG = /(?<![\p{L}\p{N}_&#/])#([\p{L}\p{N}_]+(?:[-/][\p{L}\p{N}_]+)*)/gu;
const LETTER = /\p{L}/u;

/** How a tag is stored and compared: NFC, lower case. */
export const tagKey = (tag: string) => tag.normalize("NFC").toLowerCase();

/** The tags in a text, each once, in the order they first appear. "#2026" isn't one: a tag has a letter. */
export function tagsOf(text: string): string[] {
  const tags = new Set<string>();
  for (const m of text.replace(WEB_ADDRESS, " ").matchAll(TAG)) {
    const tag = tagKey(m[1]!);
    if (!LETTER.test(tag) || tag.length > LIMITS.tagChars) continue;
    tags.add(tag);
    if (tags.size === LIMITS.tagsPerPage) break;
  }
  return [...tags];
}
