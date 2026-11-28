// The one place Valhalla 2 asks xAI's text to speech, which reads replies aloud in Grok's voices.
//
// One POST of the words (with Grok's own tags, grokTags.ts), one MP3 back. It runs on the same xAI
// key Grok companions answer with (../grok/key.ts). Every Grok voice reads every language, telling
// it from the text.
import { GROK_VOICE, type Voice } from "../../shared/protocol.ts";
import { SpeechError } from "./engine.ts";

const API = "https://api.x.ai/v1/tts";

/** What Grok is asked for: MP3, 24 kHz at 64 kbit/s, about half a megabyte a minute. */
export const GROK_FORMAT = { codec: "mp3", sample_rate: 24_000, bit_rate: 64_000 } as const;

export interface GrokSpeechOptions {
  apiKey: string;
  fetch?: typeof fetch;
  /** How long one request may take. */
  requestMs?: number;
  /** The largest audio accepted, in bytes. */
  maxBytes?: number;
}

/** One reading: the words with Grok's tags, in one of its voices (without `grok:`), at a speed. */
export interface GrokReading {
  text: string;
  voiceId: string;
  /** 0.7 to 1.5; 1 is the voice's usual. */
  speed: number;
}

export function createGrokSpeech(options: GrokSpeechOptions) {
  const { apiKey, fetch: get = globalThis.fetch, requestMs = 60_000, maxBytes = 30 * 1024 * 1024 } = options;
  const headers = { Authorization: `Bearer ${apiKey}`, "User-Agent": "valhalla2" };

  async function ask(url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await get(url, { ...init, signal: AbortSignal.timeout(requestMs) });
    } catch (err) {
      const reason = (err as Error).name === "TimeoutError" ? "it took too long to answer" : (err as Error).message;
      throw new SpeechError(`Grok's voices can't be reached: ${reason}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new SpeechError("xAI refused the server's key. Whoever runs this Valhalla 2 needs to check the xAI key.");
    }
    if (res.status === 429) {
      throw new SpeechError("Grok's voices are busy (too many requests at once). Try again in a moment.");
    }
    return res;
  }

  return {
    /** Reads the words aloud and returns the MP3. */
    async synthesize({ text, voiceId, speed }: GrokReading): Promise<Uint8Array> {
      const res = await ask(API, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voice_id: voiceId,
          language: "auto",
          ...(speed === 1 ? {} : { speed }),
          output_format: GROK_FORMAT,
        }),
      });
      if (res.status === 404) throw new SpeechError(`Grok has no voice called "${voiceId}"`);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new SpeechError(`Grok's voices answered ${res.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length === 0) throw new SpeechError("Grok sent back no audio");
      if (bytes.length > maxBytes) throw new SpeechError("The audio is larger than Valhalla 2 keeps");
      return bytes;
    },

    /** Every voice Grok offers, by name. */
    async voices(): Promise<Voice[]> {
      const res = await ask(`${API}/voices`, { headers });
      if (!res.ok) throw new SpeechError(`Grok's voices answered ${res.status} when asked for the list`);
      const raw = (await res.json().catch(() => null)) as { voices?: unknown } | null;
      if (!raw || !Array.isArray(raw.voices)) throw new SpeechError("Grok sent back no list of voices");
      return raw.voices.flatMap(grokVoiceOf).sort((a, b) => a.name.localeCompare(b.name));
    },
  };
}

/** One entry of Grok's voice list as Valhalla 2 lists it, or nothing if it isn't one. */
export function grokVoiceOf(entry: unknown): Voice[] {
  const fields = (entry ?? {}) as Record<string, unknown>;
  const id = typeof fields.voice_id === "string" ? fields.voice_id.trim().toLowerCase() : "";
  if (!/^[a-z0-9_-]+$/.test(id)) return [];
  const name = typeof fields.name === "string" && fields.name.trim() ? fields.name.trim() : id;
  return [
    {
      id: `${GROK_VOICE}${id}`,
      engine: "grok",
      name,
      locale: "",
      language: "Grok, any language",
      gender: "",
      multilingual: true,
      styles: [],
    },
  ];
}

export type GrokSpeech = ReturnType<typeof createGrokSpeech>;
