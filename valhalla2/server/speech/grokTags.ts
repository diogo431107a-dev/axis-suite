// A reply as Grok's voices read it: the words, with Grok's own tags for how they are said.
//
// Grok has no speaking styles and no pitch or volume settings, only tags in the text: wrapping ones
// (`<whisper>…</whisper>`, `<soft>`, `<loud>`, `<slow>`, `<higher-pitch>`, `<sing-song>`…) and
// sounds said at a point (`[sigh]`, `[laugh]`, `[pause]`…). Each line's feeling and strength
// (tone/) become wrapping tags; a line's sound, which the tone model gives only for a Grok voice, is
// said just before it. The words are always the reply's own.
import type { Feeling, Strength, ToneLine } from "../../shared/protocol.ts";

/** Grok's wrapping tags that Valhalla 2 uses. */
type Tag =
  | "soft"
  | "whisper"
  | "loud"
  | "build-intensity"
  | "slow"
  | "fast"
  | "higher-pitch"
  | "lower-pitch"
  | "sing-song"
  | "emphasis";

/** The tags for each feeling, slight, clear and strong, the outermost first. */
const TAGS: Readonly<Record<Feeling, readonly [slight: Tag[], clear: Tag[], strong: Tag[]]>> = {
  neutral: [[], [], []],
  narration: [["soft"], ["soft"], ["slow", "soft"]],
  warm: [[], ["soft"], ["slow", "soft"]],
  cheerful: [[], ["higher-pitch"], ["fast", "higher-pitch"]],
  excited: [["fast"], ["fast", "higher-pitch"], ["loud", "fast", "higher-pitch"]],
  playful: [[], ["sing-song"], ["fast", "sing-song"]],
  teasing: [[], ["sing-song"], ["slow", "sing-song"]],
  sarcastic: [[], ["slow"], ["slow", "emphasis"]],
  tender: [["soft"], ["slow", "soft"], ["slow", "soft", "lower-pitch"]],
  shy: [["soft"], ["soft"], ["slow", "soft"]],
  embarrassed: [[], ["fast", "soft"], ["fast", "soft", "higher-pitch"]],
  sad: [["slow"], ["slow", "lower-pitch"], ["slow", "soft", "lower-pitch"]],
  hurt: [[], ["slow"], ["slow", "lower-pitch"]],
  angry: [["emphasis"], ["loud"], ["loud", "fast"]],
  cold: [["lower-pitch"], ["slow", "lower-pitch"], ["slow", "lower-pitch", "emphasis"]],
  fearful: [["fast"], ["fast", "higher-pitch"], ["fast", "soft", "higher-pitch"]],
  whispering: [["whisper"], ["whisper"], ["slow", "whisper"]],
  shouting: [["loud"], ["loud"], ["loud", "build-intensity"]],
  serious: [[], ["slow"], ["slow", "lower-pitch"]],
  calm: [[], ["slow"], ["slow", "soft"]],
};

/** The tags a line is read with. */
export const tagsFor = (feeling: Feeling, strength: Strength): readonly Tag[] => TAGS[feeling][strength - 1]!;

/**
 * The reply's own words, made safe: brackets become parentheses and angle brackets go, so nothing
 * in them is taken for one of Grok's tags.
 */
export const grokWords = (text: string): string => text.replace(/\[/g, "(").replace(/\]/g, ")").replace(/[<>]/g, "");

/** The words read plainly. */
export const plainGrok = (text: string): string => grokWords(text);

const wrap = (tags: readonly Tag[], said: string): string =>
  tags.reduceRight((inner, tag) => `<${tag}>${inner}</${tag}>`, said);

/**
 * The reply as Grok reads it with feeling. Lines next to each other in a paragraph with the same
 * tags are wrapped together, since Grok reads tags best over whole phrases; paragraphs are apart.
 */
export function directedGrok(lines: readonly ToneLine[]): string {
  /** Each paragraph as runs of lines read with the same tags. */
  const paragraphs: { tags: readonly Tag[]; said: string[] }[][] = [];
  for (const [at, line] of lines.entries()) {
    if (at === 0 || line.paragraph) paragraphs.push([]);
    const runs = paragraphs.at(-1)!;
    const tags = tagsFor(line.feeling, line.strength);
    const said = `${line.sound ? `[${line.sound}] ` : ""}${grokWords(line.text)}`;
    const last = runs.at(-1);
    if (last && last.tags.join() === tags.join()) last.said.push(said);
    else runs.push({ tags, said: [said] });
  }
  return paragraphs.map((runs) => runs.map((run) => wrap(run.tags, run.said.join(" "))).join(" ")).join("\n\n");
}
