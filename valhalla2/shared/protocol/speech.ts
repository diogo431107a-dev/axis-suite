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
}

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
