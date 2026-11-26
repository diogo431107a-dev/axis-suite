// What is read aloud: the reply as written, without the asterisks that mark actions, so the voice
// reads the actions in the same voice as the rest instead of saying "asterisk".
import { DEFAULT_TUNING, LIMITS, type VoiceTuning } from "../../shared/protocol.ts";

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

const percent = (value: number): string => `${value >= 0 ? "+" : ""}${Math.round(value)}%`;

/** How words are said: in one of the voice's styles, and faster or slower, higher or lower, louder or softer. */
export interface Delivery {
  style?: string | null;
  /** How strongly the style is applied, as Azure takes it; left out for its usual. */
  degree?: string;
  /** Each in percent; 0 or left out is the voice's usual. */
  rate?: number;
  pitch?: number;
  volume?: number;
}

/** Escaped words, said the way `how` says: speed, pitch and volume inside the style. */
export function deliver(said: string, how: Delivery): string {
  const attributes = [
    how.rate ? `rate="${percent(how.rate)}"` : "",
    how.pitch ? `pitch="${percent(how.pitch)}"` : "",
    how.volume ? `volume="${percent(how.volume)}"` : "",
  ].filter(Boolean);
  const shaped = attributes.length > 0 && said ? `<prosody ${attributes.join(" ")}>${said}</prosody>` : said;
  if (!how.style) return shaped;
  const degree = how.degree ? ` styledegree="${how.degree}"` : "";
  return `<mstts:express-as style="${escapeXml(how.style)}"${degree}>${shaped}</mstts:express-as>`;
}

/**
 * Two changes of speed or pitch, one on top of the other: 10% faster and then 10% faster again is
 * 21% faster. Kept within what Azure takes.
 */
export function combine(a: number, b: number, min: number, max: number): number {
  const both = ((1 + a / 100) * (1 + b / 100) - 1) * 100;
  return Math.min(max, Math.max(min, both));
}

export const combineRate = (a: number, b: number): number => combine(a, b, LIMITS.voiceRateMin, LIMITS.voiceRateMax);
export const combinePitch = (a: number, b: number): number => combine(a, b, LIMITS.voicePitchMin, LIMITS.voicePitchMax);

/** The whole SSML document: `body` in one voice, in the voice's language. */
export function speak(voice: string, body: string, styled: boolean): string {
  const mstts = styled ? ' xmlns:mstts="https://www.w3.org/2001/mstts"' : "";
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"${mstts} xml:lang="${escapeXml(langOf(voice))}">` +
    `<voice name="${escapeXml(voice)}">${body}</voice></speak>`
  );
}

/**
 * The SSML Azure reads: the text in one voice, at the companion's speed and pitch, in its speaking
 * style if it has one. The language is the voice's own; a multilingual voice (such as Ava
 * Multilingual) still reads other languages, telling them from the text.
 */
export function ssmlOf(text: string, voice: string, tuning: VoiceTuning = DEFAULT_TUNING): string {
  const body = deliver(escapeXml(text), { style: tuning.style, rate: tuning.rate, pitch: tuning.pitch });
  return speak(voice, body, tuning.style !== null);
}
