// Which prompt a day offers. It depends only on the date (and how many times "Another" was
// clicked), so a day keeps its prompt across visits and tabs.
import { BUILTIN_PROMPTS } from "./builtin.ts";

/** The user's prompts, or the built-in ones. */
export const promptList = (own: readonly string[] | null) => (own && own.length > 0 ? own : BUILTIN_PROMPTS);

/** FNV-1a: a small, stable hash of a text. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** The prompt for a day; `skip` moves on to the next ones ("Another"). */
export function promptFor(date: string, prompts: readonly string[], skip = 0): string {
  if (prompts.length === 0) return "";
  return prompts[(hash(date) + skip) % prompts.length]!;
}
