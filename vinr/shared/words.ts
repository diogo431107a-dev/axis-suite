// Text helpers shared by the server and the page: matching without case or accents, word counts,
// one-line previews.

/**
 * A text for matching, and where each of its characters came from. Lower case, accents removed
 * ("Café" → "cafe"), one character at a time, so `map[i]` is the index in the original text of
 * normalized character i, and `map[text.length]` is the original's length. Search finds a word in
 * `text` and marks the same place in the original with `map`.
 */
export function normalizeWithMap(original: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  for (let i = 0; i < original.length;) {
    const code = original.charCodeAt(i);
    if (code < 0x80) {
      // ASCII, nearly every character: no accents to strip.
      text += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : original[i];
      map.push(i);
      i += 1;
      continue;
    }
    const char = String.fromCodePoint(original.codePointAt(i)!);
    const plain = char.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    for (let k = 0; k < plain.length; k++) map.push(i);
    text += plain;
    i += char.length;
  }
  map.push(original.length);
  return { text, map };
}

/** Lower case, accents removed: "Été" and "ete" are the same word. */
export const normalize = (s: string) => normalizeWithMap(s).text;

const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });

/** How many words a text has, in any script. */
export function countWords(text: string): number {
  let n = 0;
  for (const s of segmenter.segment(text)) if (s.isWordLike) n++;
  return n;
}

/** The start of a text on one line, at most `max` characters, cut at a space if one is near. */
export function preview(text: string, max: number): string {
  const line = text
    .slice(0, max * 2 + 20)
    .replace(/\s+/g, " ")
    .trim();
  if (line.length <= max) return line;
  const cut = line.lastIndexOf(" ", max);
  return `${line.slice(0, cut > max * 0.6 ? cut : max)}…`;
}
