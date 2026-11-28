import { describe, expect, it } from "vitest";
import { SpeechError } from "./engine.ts";
import { createGrokSpeech, GROK_FORMAT, grokVoiceOf } from "./grok.ts";

const MP3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0]);

function fake(answer: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return answer();
  }) as unknown as typeof globalThis.fetch;
  return { calls, grok: createGrokSpeech({ apiKey: "xai-123", fetch }) };
}

describe("Grok's voices", () => {
  it("posts the words, the voice and the speed with the key, and returns the MP3", async () => {
    const { calls, grok } = fake(() => new Response(MP3, { status: 200 }));
    const audio = await grok.synthesize({ text: "<soft>Hello.</soft>", voiceId: "eve", speed: 1.2 });
    expect(audio).toEqual(MP3);
    const [{ url, init }] = calls as [{ url: string; init: RequestInit }];
    expect(url).toBe("https://api.x.ai/v1/tts");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer xai-123", "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      text: "<soft>Hello.</soft>",
      voice_id: "eve",
      language: "auto",
      speed: 1.2,
      output_format: GROK_FORMAT,
    });
  });

  it("leaves the speed out at the voice's usual", async () => {
    const { calls, grok } = fake(() => new Response(MP3, { status: 200 }));
    await grok.synthesize({ text: "Hi.", voiceId: "eve", speed: 1 });
    expect(JSON.parse(calls[0]!.init.body as string)).not.toHaveProperty("speed");
  });

  it("says what went wrong in plain words", async () => {
    const reading = { text: "Hi.", voiceId: "nobody", speed: 1 };
    await expect(fake(() => new Response("", { status: 401 })).grok.synthesize(reading)).rejects.toThrow(
      /refused the server's key/,
    );
    await expect(fake(() => new Response("", { status: 404 })).grok.synthesize(reading)).rejects.toThrow(
      /no voice called "nobody"/,
    );
    await expect(fake(() => new Response("", { status: 429 })).grok.synthesize(reading)).rejects.toThrow(/busy/);
    await expect(fake(() => new Response("bad codec", { status: 400 })).grok.synthesize(reading)).rejects.toThrow(
      "Grok's voices answered 400: bad codec",
    );
    await expect(fake(() => new Response(new Uint8Array(), { status: 200 })).grok.synthesize(reading)).rejects.toThrow(
      /no audio/,
    );
    await expect(fake(() => Promise.reject(new Error("offline"))).grok.synthesize(reading)).rejects.toBeInstanceOf(
      SpeechError,
    );
  });

  it("lists its voices as grok: voices that read any language, by name", async () => {
    const { calls, grok } = fake(() =>
      Response.json({
        voices: [
          { voice_id: "rex", name: "Rex", language: "en" },
          { voice_id: "Eve", name: "Eve", language: "en" },
          { name: "no id" },
        ],
      }),
    );
    const voices = await grok.voices();
    expect(calls[0]!.url).toBe("https://api.x.ai/v1/tts/voices");
    expect(voices.map((voice) => voice.id)).toEqual(["grok:eve", "grok:rex"]);
    expect(voices[0]).toEqual({
      id: "grok:eve",
      engine: "grok",
      name: "Eve",
      locale: "",
      language: "Grok, any language",
      gender: "",
      multilingual: true,
      styles: [],
    });
  });

  it("takes no voice id that isn't a plain name", () => {
    expect(grokVoiceOf({ voice_id: "../x" })).toEqual([]);
    expect(grokVoiceOf(null)).toEqual([]);
  });
});
