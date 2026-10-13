// Breaking a node's text into lines that fit its width. Lines break where the text has a line
// break, then at spaces; a word wider than a whole line (a long URL) breaks between characters.
// Runs of spaces count as one, as the SVG shows them.

/** The width of a piece of text, in px. */
export type Width = (text: string) => number;

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter() : null;

/** The characters as people see them (an emoji with its modifiers is one). */
const graphemes = (text: string): string[] =>
  segmenter ? [...segmenter.segment(text)].map((s) => s.segment) : [...text];

/** Breaks a word too wide for a line into pieces that fit; the last may be short. */
function breakWord(word: string, max: number, width: Width): string[] {
  const pieces: string[] = [];
  let piece = "";
  for (const g of graphemes(word)) {
    if (piece && width(piece + g) > max) {
      pieces.push(piece);
      piece = g;
    } else piece += g;
  }
  pieces.push(piece);
  return pieces;
}

/** The lines `text` takes when no line may be wider than `max`. Always at least one (maybe ""). */
export function wrap(text: string, max: number, width: Width): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/[ \t]+/).filter((w) => w !== "");
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (width(candidate) <= max) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (width(word) <= max) {
        line = word;
      } else {
        const pieces = breakWord(word, max, width);
        lines.push(...pieces.slice(0, -1));
        line = pieces.at(-1)!;
      }
    }
    lines.push(line);
  }
  return lines;
}
