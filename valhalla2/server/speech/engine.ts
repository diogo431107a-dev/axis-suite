// What reads a reply aloud: Azure or Grok, chosen by the voice (a Grok voice's id starts `grok:`).
//
// The store (store.ts) keeps, counts and serves the audio; an engine only turns a reply into sound.
// What it is given is the same for every engine: the reply's words, and when it is read with
// feeling, its lines with a feeling and a strength each (tone/), which the tone model wrote with
// no engine in mind, and for a Grok voice a sound before a line now and then. Each engine says them
// its own way: Azure through SSML, with its voices' own styles where they fit (direct.ts); Grok
// through its own tags (grokTags.ts).
import {
  GROK_VOICE,
  LIMITS,
  type SpeechEngine,
  type ToneLine,
  type Voice,
  type VoiceTuning,
} from "../../shared/protocol.ts";
import type { AzureSpeech } from "./azure.ts";
import { directedSsml } from "./direct.ts";
import type { GrokSpeech } from "./grok.ts";
import { directedGrok, plainGrok } from "./grokTags.ts";
import { ssmlOf } from "./text.ts";

/** A reply an engine refused or failed to read. Its message is shown as it is. */
export class SpeechError extends Error {}

/** One reading: the words, in a voice, plainly or line by line with feeling, at a tuning. */
export interface VoiceReading {
  /** The voice's id, as a companion stores it. */
  voice: string;
  /** The words as they are read: actions without their asterisks (text.ts). */
  text: string;
  /** Each line with its feeling and how strongly, or null to read the words plainly. */
  lines: readonly ToneLine[] | null;
  tuning: VoiceTuning;
  /** The speaking styles this voice has of its own (Azure's); none for an engine without them. */
  styles: readonly string[];
}

export interface VoiceEngine {
  /** Kept with each reading, so another engine's audio is never taken for this one's. */
  readonly id: SpeechEngine;
  /** What its audio is: the file ending it is kept under, and the type it is served as. */
  readonly format: { ext: string; type: string };
  /** Every voice it offers. */
  voices(): Promise<Voice[]>;
  /**
   * The part of a tuning it reads, within what it takes, so what it ignores reads nothing again.
   * Left out: all of it.
   */
  tune?(tuning: VoiceTuning): VoiceTuning;
  /** The audio of one reading. Throws SpeechError when the engine refuses or can't be reached. */
  read(reading: VoiceReading): Promise<Uint8Array>;
}

/** Azure AI Speech as an engine: each reading becomes SSML, plain or directed line by line. */
export function azureVoice(azure: AzureSpeech): VoiceEngine {
  return {
    id: "azure",
    format: { ext: "mp3", type: "audio/mpeg" },
    voices: () => azure.voices(),
    read: ({ voice, text, lines, tuning, styles }) =>
      azure.synthesize(lines ? directedSsml(lines, voice, styles, tuning) : ssmlOf(text, voice, tuning)),
  };
}

/** Grok's speed for a tuning's rate: 0.7 to 1.5 times the voice's usual. */
export const grokSpeed = (rate: number): number => Math.round((1 + rate / 100) * 100) / 100;

/**
 * xAI's voices as an engine: each reading becomes the words with Grok's tags. Only the speed of a
 * tuning counts: Grok's voices have no pitch setting and no styles.
 */
export function grokVoice(grok: GrokSpeech): VoiceEngine {
  const tune = (tuning: VoiceTuning): VoiceTuning => ({
    rate: Math.min(LIMITS.grokRateMax, Math.max(LIMITS.grokRateMin, tuning.rate)),
    pitch: 0,
    style: null,
  });
  return {
    id: "grok",
    format: { ext: "mp3", type: "audio/mpeg" },
    voices: () => grok.voices(),
    tune,
    read: ({ voice, text, lines, tuning }) =>
      grok.synthesize({
        text: lines ? directedGrok(lines) : plainGrok(text),
        voiceId: voice.startsWith(GROK_VOICE) ? voice.slice(GROK_VOICE.length) : voice,
        speed: grokSpeed(tune(tuning).rate),
      }),
  };
}

/** The type an audio file is served as, from its ending. */
export const AUDIO_TYPES: Readonly<Record<string, string>> = {
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
};
