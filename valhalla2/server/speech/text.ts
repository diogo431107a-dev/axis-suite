// What is read aloud: the reply as written, without the asterisks that mark actions, so the voice
// reads the actions in the same voice as the rest instead of saying "asterisk".

/** The reply's text as it is to be spoken: asterisks gone, spaces and blank lines tidied. */
export function spokenText(text: string): string {
  return text
    .replace(/\*+/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const XML: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" };
export const escapeXml = (s: string): string => s.replace(/[<>&'"]/g, (c) => XML[c]!);

/** The language a voice is made for, from its name: `pt-BR` for pt-BR-FranciscaNeural. */
export const langOf = (voice: string): string => voice.split("-").slice(0, 2).join("-");

/**
 * The SSML Azure reads: the text in one voice. The language is the voice's own; a multilingual
 * voice (such as Ava Multilingual) still reads other languages, telling them from the text.
 */
export function ssmlOf(text: string, voice: string): string {
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${escapeXml(langOf(voice))}">` +
    `<voice name="${escapeXml(voice)}">${escapeXml(text)}</voice></speak>`
  );
}
