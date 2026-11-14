// The one place Valhalla 2 talks to Azure AI Speech, which reads replies aloud.
//
// It uses Azure's REST endpoint for text to speech: one POST of SSML, one MP3 back. It is the same
// service the Speech SDK talks to, without the SDK's websockets and dependencies.

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
  const url = `https://${encodeURIComponent(region)}.tts.speech.microsoft.com/cognitiveservices/v1`;

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
  };
}

export type AzureSpeech = ReturnType<typeof createAzureSpeech>;
