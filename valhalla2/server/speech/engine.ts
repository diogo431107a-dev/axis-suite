// What reads a reply aloud: Azure today, and later another voice (Grok's) for any companion.
//
// The store (store.ts) keeps, counts and serves the audio; an engine only turns a reply into sound.
// What it is given is the same for every engine: the reply's words, and when it is read with
// feeling, its lines with a feeling and a strength each (tone/), which the tone model wrote with
// no engine in mind. Each engine says them its own way: Azure through SSML, with its voices' own
// styles where they fit (direct.ts); another engine through its own tags.
import type { ToneLine, Voice, VoiceTuning } from "../../shared/protocol.ts";
import type { AzureSpeech } from "./azure.ts";
import { directedSsml } from "./direct.ts";
import { ssmlOf } from "./text.ts";

/** One reading: the words, in a voice, plainly or line by line with feeling, at a tuning. */
export interface VoiceReading {
  /** The engine's id for the voice. */
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
  readonly id: string;
  /** What its audio is: the file ending it is kept under, and the type it is served as. */
  readonly format: { ext: string; type: string };
  /** Every voice it offers. */
  voices(): Promise<Voice[]>;
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

/** The type an audio file is served as, from its ending. */
export const AUDIO_TYPES: Readonly<Record<string, string>> = {
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
};
