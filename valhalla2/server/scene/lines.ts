// A reply cut into the lines its reading is directed by: actions (in asterisks) apart from speech,
// then each into sentences. Valhalla 2 cuts them and numbers them, and Claude only says how each
// is said, so the words read aloud are always exactly the reply's.
import { segmentsOf } from "../../shared/emphasis.ts";
import { spokenText } from "../speech/text.ts";

export interface Line {
  text: string;
  action: boolean;
  /** The first line of a paragraph. */
  paragraph: boolean;
}

/** Ends a sentence: its closing punctuation (and any closing quote), then space. */
const SENTENCE = /(?<=[.!?…]["'”’)»]*)\s+/u;

/** The reply's lines, in order, none empty. */
export function linesOf(text: string): Line[] {
  const lines: Line[] = [];
  let paragraph = true;
  for (const segment of segmentsOf(text)) {
    // A blank line inside a segment starts a new paragraph after it.
    const parts = segment.text.split(/\n{2,}/);
    parts.forEach((part, at) => {
      if (at > 0) paragraph = true;
      for (const sentence of spokenText(part).split(SENTENCE)) {
        const said = sentence.trim();
        if (!said) continue;
        lines.push({ text: said, action: segment.action, paragraph });
        paragraph = false;
      }
    });
  }
  return lines;
}

/** The lines as Claude reads them: numbered, each marked as speech or action. */
export function numbered(lines: Line[]): string {
  return lines
    .map((line, at) => `${at + 1}. (${line.action ? "action" : "speech"}) ${line.text.replaceAll("\n", " ")}`)
    .join("\n");
}
