import { describe, expect, it } from "vitest";
import { AUDIO_FORMAT, createAzureSpeech, SpeechError } from "./azure.ts";

const MP3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0]);

function fake(answer: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return answer();
  }) as unknown as typeof globalThis.fetch;
  return { calls, azure: createAzureSpeech({ key: "k-123", region: "brazilsouth", fetch }) };
}

describe("Azure Speech", () => {
  it("posts the SSML to the region's endpoint with the key, and returns the MP3", async () => {
    const { calls, azure } = fake(() => new Response(MP3, { status: 200 }));
    const audio = await azure.synthesize("<speak/>");
    expect(audio).toEqual(MP3);
    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls as [{ url: string; init: RequestInit }];
    expect(url).toBe("https://brazilsouth.tts.speech.microsoft.com/cognitiveservices/v1");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("<speak/>");
    expect(init.headers).toMatchObject({
      "Ocp-Apim-Subscription-Key": "k-123",
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": AUDIO_FORMAT,
    });
  });

  it("says when the key is refused", async () => {
    const { azure } = fake(() => new Response("", { status: 401 }));
    await expect(azure.synthesize("<speak/>")).rejects.toThrow(/refused the server's key/);
  });

  it("says when the free tier is busy", async () => {
    const { azure } = fake(() => new Response("", { status: 429 }));
    await expect(azure.synthesize("<speak/>")).rejects.toThrow(/busy/);
  });

  it("passes on any other failure with what Azure said", async () => {
    const { azure } = fake(() => new Response("bad SSML", { status: 400 }));
    await expect(azure.synthesize("<speak/>")).rejects.toThrow("Azure Speech answered 400: bad SSML");
  });

  it("says when Azure can't be reached", async () => {
    const { azure } = fake(() => Promise.reject(new TypeError("fetch failed")));
    await expect(azure.synthesize("<speak/>")).rejects.toBeInstanceOf(SpeechError);
  });

  it("refuses an empty answer", async () => {
    const { azure } = fake(() => new Response(new Uint8Array(0), { status: 200 }));
    await expect(azure.synthesize("<speak/>")).rejects.toThrow(/no audio/);
  });
});
