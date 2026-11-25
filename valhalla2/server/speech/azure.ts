// The one place Valhalla 2 talks to Azure AI Speech, which reads replies aloud.
//
// It uses Azure's REST endpoint for text to speech: one POST of SSML, one MP3 back. It is the same
// service the Speech SDK talks to, without the SDK's websockets and dependencies. The voices a
// companion can choose from come from the same region's voice list.
import type { Voice } from "../../shared/protocol.ts";

/** What Azure is asked for: MP3, 24 kHz mono at 48 kbit/s, which every browser plays. */
export const AUDIO_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

/** A reply Azure refused or failed to read. */
export class SpeechError extends Error {}

export interface AzureSpeechOptions {
  key: string;
  /** The Azure region of the Speech resource, such as `brazilsouth`. */
  region: string;
  fetch?: typeof fetch;
  /** How long one request may take. */
  requestMs?: number;
  /** The largest audio accepted, in bytes. */
  maxBytes?: number;
}

export function createAzureSpeech(options: AzureSpeechOptions) {
  const { key, region, fetch: get = globalThis.fetch, requestMs = 60_000, maxBytes = 30 * 1024 * 1024 } = options;
  const host = `https://${encodeURIComponent(region)}.tts.speech.microsoft.com/cognitiveservices`;
  const url = `${host}/v1`;
  const listUrl = `${host}/voices/list`;

  return {
    /** Reads SSML aloud and returns the MP3. */
    async synthesize(ssml: string): Promise<Uint8Array> {
      let res: Response;
      try {
        res = await get(url, {
          method: "POST",
          headers: {
            "Ocp-Apim-Subscription-Key": key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": AUDIO_FORMAT,
            "User-Agent": "valhalla2",
          },
          body: ssml,
          signal: AbortSignal.timeout(requestMs),
        });
      } catch (err) {
        const reason = (err as Error).name === "TimeoutError" ? "it took too long to answer" : (err as Error).message;
        throw new SpeechError(`Azure Speech can't be reached: ${reason}`);
      }
      if (res.status === 401 || res.status === 403) {
        throw new SpeechError(
          "Azure Speech refused the server's key. Whoever runs this Valhalla 2 needs to check the key and its region.",
        );
      }
      if (res.status === 429) {
        throw new SpeechError("Azure Speech is busy (too many requests at once). Try again in a moment.");
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new SpeechError(`Azure Speech answered ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length === 0) throw new SpeechError("Azure Speech sent back no audio");
      if (bytes.length > maxBytes) throw new SpeechError("The audio is larger than Valhalla 2 keeps");
      return bytes;
    },

    /** Every voice the region offers, by language and then name. Asking costs nothing. */
    async voices(): Promise<Voice[]> {
      let res: Response;
      try {
        res = await get(listUrl, {
          headers: { "Ocp-Apim-Subscription-Key": key, "User-Agent": "valhalla2" },
          signal: AbortSignal.timeout(requestMs),
        });
      } catch (err) {
        const reason = (err as Error).name === "TimeoutError" ? "it took too long to answer" : (err as Error).message;
        throw new SpeechError(`Azure Speech can't be reached: ${reason}`);
      }
      if (res.status === 401 || res.status === 403) {
        throw new SpeechError(
          "Azure Speech refused the server's key. Whoever runs this Valhalla 2 needs to check the key and its region.",
        );
      }
      if (!res.ok) throw new SpeechError(`Azure Speech answered ${res.status} when asked for its voices`);
      const raw = (await res.json().catch(() => null)) as unknown;
      if (!Array.isArray(raw)) throw new SpeechError("Azure Speech sent back no list of voices");
      return raw.flatMap(voiceOf).sort((a, b) => a.language.localeCompare(b.language) || a.name.localeCompare(b.name));
    },
  };
}

/** One entry of Azure's voice list as Valhalla 2 lists it, or nothing if it isn't one. */
export function voiceOf(entry: unknown): Voice[] {
  const fields = (entry ?? {}) as Record<string, unknown>;
  const str = (value: unknown): string => (typeof value === "string" ? value : "");
  const id = str(fields.ShortName);
  if (!id) return [];
  const secondary = Array.isArray(fields.SecondaryLocaleList) ? fields.SecondaryLocaleList : [];
  return [
    {
      id,
      name: str(fields.DisplayName) || id,
      locale: str(fields.Locale),
      language: str(fields.LocaleName) || str(fields.Locale),
      gender: str(fields.Gender),
      multilingual: secondary.length > 0 || id.includes("Multilingual"),
    },
  ];
}

export type AzureSpeech = ReturnType<typeof createAzureSpeech>;
