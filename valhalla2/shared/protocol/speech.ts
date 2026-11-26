// Reading aloud: the voices Azure offers, and a reply read aloud.

/** One of Azure's voices, as the companion page lists it. */
export interface Voice {
  /** What Azure calls it, and what a companion stores: `en-US-AvaMultilingualNeural`. */
  id: string;
  /** Its own name: `Ava Multilingual`. */
  name: string;
  /** The language it is made for, as a code and in words: `en-US`, `English (United States)`. */
  locale: string;
  language: string;
  gender: string;
  /** Whether it also reads other languages, telling them from the text. */
  multilingual: boolean;
  /** The speaking styles it has of its own (cheerful, whispering…); most voices have none. */
  styles: string[];
}

/**
 * How a companion's voice is set, beyond which voice it is: faster or slower, higher or lower, and
 * a speaking style of its own for the lines that have no feeling of their own. Feelings are read on
 * top of these.
 */
export interface VoiceTuning {
  /** In whole percent; 0 is the voice's usual speed. */
  rate: number;
  /** In whole percent; 0 is the voice's usual pitch. */
  pitch: number;
  /** One of the voice's own styles (chat, friendly…); null for none. */
  style: string | null;
}

/** The voice as it comes. */
export const DEFAULT_TUNING: VoiceTuning = { rate: 0, pitch: 0, style: null };

/** Whether `tuning` changes anything. */
export const isDefaultTuning = (tuning: VoiceTuning): boolean =>
  tuning.rate === 0 && tuning.pitch === 0 && tuning.style === null;

/** Every voice the server's Azure region offers, and the one used when a companion names none. */
export interface VoiceList {
  voices: Voice[];
  default: string;
}

/** A reply read aloud: where its audio is, and how much Azure has read this month. */
export interface SpeechReply {
  url: string;
  /** Characters Azure was asked to read this calendar month (UTC), by everyone on this server. */
  monthChars: number;
}
