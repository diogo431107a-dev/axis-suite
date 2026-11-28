// A reply read with feeling: each line in the way its tags say it is said (tone/store.ts).
//
// Azure has two ways to direct a voice. A few voices have speaking styles of their own (cheerful,
// whispering, sad…), which sound the most natural; a line whose feeling matches one of the voice's
// styles is read in it. Every voice follows speed, pitch and volume, so every other line is read
// with those, set for its feeling, in the companion's own speaking style if it has one. The
// companion's speed and pitch are under all of it. The words are always the reply's own.
import { DEFAULT_TUNING, type Feeling, type ToneLine, type Strength, type VoiceTuning } from "../../shared/protocol.ts";
import { combinePitch, combineRate, deliver, escapeXml, speak } from "./text.ts";

/** The voice's own styles that fit a feeling, the closest first. */
const STYLES: Readonly<Record<Feeling, readonly string[]>> = {
  neutral: [],
  narration: ["narration-relaxed", "narration-professional"],
  warm: ["friendly", "affectionate", "gentle"],
  cheerful: ["cheerful", "friendly", "excited"],
  excited: ["excited", "cheerful"],
  playful: ["funny", "cheerful", "friendly"],
  teasing: ["funny", "friendly", "cheerful"],
  sarcastic: ["unfriendly", "disgruntled"],
  tender: ["affectionate", "gentle", "empathetic"],
  shy: ["shy", "embarrassed", "gentle"],
  embarrassed: ["embarrassed", "shy"],
  sad: ["sad", "depressed", "empathetic"],
  hurt: ["sad", "empathetic"],
  angry: ["angry", "disgruntled", "shouting"],
  cold: ["unfriendly", "serious"],
  fearful: ["fearful", "terrified"],
  whispering: ["whispering"],
  shouting: ["shouting", "angry"],
  serious: ["serious", "calm"],
  calm: ["calm", "gentle"],
};

/** How strongly a style is applied: Azure takes 0.01 to 2, 1 being its usual. */
const DEGREE: Readonly<Record<Strength, string>> = { 1: "0.8", 2: "1.2", 3: "1.6" };

/** Speed, pitch and volume for a feeling said clearly, in percent; slight is half, strong half again. */
const PROSODY: Readonly<Record<Feeling, readonly [rate: number, pitch: number, volume: number]>> = {
  neutral: [0, 0, 0],
  narration: [-6, -3, -10],
  warm: [-4, 2, 0],
  cheerful: [6, 6, 5],
  excited: [12, 8, 10],
  playful: [6, 5, 0],
  teasing: [3, 4, 0],
  sarcastic: [-6, -3, 0],
  tender: [-10, 2, -15],
  shy: [-6, 2, -20],
  embarrassed: [-4, 3, -15],
  sad: [-12, -6, -15],
  hurt: [-8, -4, -10],
  angry: [8, 3, 20],
  cold: [-6, -6, -5],
  fearful: [6, 6, -10],
  whispering: [-8, -4, -40],
  shouting: [6, 6, 40],
  serious: [-6, -4, 0],
  calm: [-10, -3, -5],
};
const SCALE: Readonly<Record<Strength, number>> = { 1: 0.5, 2: 1, 3: 1.5 };

/** The voice's own style for a feeling, if it has one that fits. */
export function styleFor(feeling: Feeling, styles: readonly string[]): string | null {
  return STYLES[feeling].find((style) => styles.includes(style)) ?? null;
}

/**
 * One line: in the voice's style for its feeling, or else in the companion's own style, with speed,
 * pitch and volume. The companion's speed and pitch are under everything; a feeling read with
 * speed and pitch is read on top of them.
 */
function lineOf(line: ToneLine, styles: readonly string[], tuning: VoiceTuning): string {
  const said = escapeXml(line.text);
  const style = styleFor(line.feeling, styles);
  if (style) {
    return deliver(said, { style, degree: DEGREE[line.strength], rate: tuning.rate, pitch: tuning.pitch });
  }
  const [rate, pitch, volume] = PROSODY[line.feeling].map((value) => value * SCALE[line.strength]) as [
    number,
    number,
    number,
  ];
  return deliver(said, {
    style: tuning.style,
    rate: combineRate(tuning.rate, rate),
    pitch: combinePitch(tuning.pitch, pitch),
    volume,
  });
}

/**
 * The SSML Azure reads: the lines in one voice, each said its way, a pause between paragraphs.
 * The companion's style is used only if the voice has it, which is the caller's to check.
 */
export function directedSsml(
  lines: readonly ToneLine[],
  voice: string,
  styles: readonly string[],
  tuning: VoiceTuning = DEFAULT_TUNING,
): string {
  const said = lines.map(
    (line, at) => `${line.paragraph && at > 0 ? '<break time="400ms"/>' : ""}${lineOf(line, styles, tuning)}`,
  );
  return speak(voice, said.join(" "), true);
}
