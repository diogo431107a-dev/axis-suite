import { describe, expect, it } from "vitest";
import { bodyFor, createGrokImagine, errorWords, GrokImagineError, takesQuality, type GrokImage } from "./grok.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

const image: GrokImage = {
  model: "grok-imagine-image-2.0",
  prompt: "An anime illustration of a woman with gold hair.",
  aspectRatio: "2:3",
  resolution: "1k",
  quality: "auto",
};

/** A fetch that answers every request with `status` and `body`, and keeps what it was asked. */
function answering(status: number, body: unknown) {
  const asked: { url: string; init: RequestInit }[] = [];
  const fetch = (url: string | URL | Request, init?: RequestInit) => {
    asked.push({ url: String(url), init: init ?? {} });
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return Promise.resolve(new Response(text, { status }));
  };
  return { asked, fetch: fetch as typeof globalThis.fetch };
}

const made = (bytes: Uint8Array, ticks?: number) => ({
  data: [{ b64_json: b64(bytes), mime_type: "image/jpeg" }],
  ...(ticks === undefined ? {} : { usage: { cost_in_usd_ticks: ticks } }),
});

describe("Grok Imagine", () => {
  it("is asked for one picture, as base64, in the shape, size and quality chosen", async () => {
    const { asked, fetch } = answering(200, made(JPEG, 400_000_000));
    await createGrokImagine({ apiKey: "xai-key", fetch }).generate(image);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.url).toBe("https://api.x.ai/v1/images/generations");
    expect(asked[0]!.init.method).toBe("POST");
    expect((asked[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer xai-key");
    expect(JSON.parse(String(asked[0]!.init.body))).toEqual({
      model: "grok-imagine-image-2.0",
      prompt: image.prompt,
      n: 1,
      aspect_ratio: "2:3",
      resolution: "1k",
      quality: "auto",
      response_format: "b64_json",
    });
  });

  it("is sent a quality only on the model that takes one", () => {
    expect(takesQuality("grok-imagine-image-2.0")).toBe(true);
    expect(takesQuality("grok-imagine-image")).toBe(false);
    expect(bodyFor({ ...image, model: "grok-imagine-image" })).not.toHaveProperty("quality");
  });

  it("answers with the picture, its type from its bytes, and its cost in dollars", async () => {
    const { fetch } = answering(200, made(PNG, 400_000_000));
    const picture = await createGrokImagine({ apiKey: "k", fetch }).generate(image);
    expect(picture).toEqual({ bytes: PNG, type: "image/png", ext: "png", cost: 0.04 });
  });

  it("has no cost when xAI doesn't say", async () => {
    const { fetch } = answering(200, made(JPEG));
    expect((await createGrokImagine({ apiKey: "k", fetch }).generate(image)).cost).toBeNull();
  });

  it("refuses an answer that isn't a picture, or is too large", async () => {
    const text = answering(200, made(new TextEncoder().encode("<html>no</html>")));
    await expect(createGrokImagine({ apiKey: "k", fetch: text.fetch }).generate(image)).rejects.toThrow(
      /isn't a picture/,
    );
    const empty = answering(200, { data: [] });
    await expect(createGrokImagine({ apiKey: "k", fetch: empty.fetch }).generate(image)).rejects.toThrow(
      /sent no picture/,
    );
    const big = answering(200, made(new Uint8Array(4_000).fill(0xff)));
    await expect(createGrokImagine({ apiKey: "k", fetch: big.fetch, maxBytes: 1_000 }).generate(image)).rejects.toThrow(
      /larger than/,
    );
  });

  it("says in plain words why it didn't make a picture", async () => {
    const cases: [number, unknown, RegExp][] = [
      [401, { error: "bad key" }, /refused the server's key/],
      [403, "", /refused the server's key/],
      [429, "", /busy/],
      [
        400,
        { error: "Generated image rejected by content moderation." },
        /refused this prompt: Generated image rejected/,
      ],
      [422, { error: { message: "prompt too long" } }, /refused this prompt: prompt too long.*may still charge/],
      [500, "upstream down", /answered 500: upstream down/],
    ];
    for (const [status, body, words] of cases) {
      const { fetch } = answering(status, body);
      const asking = createGrokImagine({ apiKey: "k", fetch }).generate(image);
      await expect(asking).rejects.toThrow(GrokImagineError);
      await expect(createGrokImagine({ apiKey: "k", fetch }).generate(image)).rejects.toThrow(words);
    }
  });

  it("says so when it can't be reached", async () => {
    const fetch = (() => Promise.reject(new Error("ECONNREFUSED"))) as typeof globalThis.fetch;
    await expect(createGrokImagine({ apiKey: "k", fetch }).generate(image)).rejects.toThrow(
      /can't be reached: ECONNREFUSED/,
    );
  });

  it("reads xAI's error words whichever shape they come in", () => {
    expect(errorWords('{"error":"no"}')).toBe("no");
    expect(errorWords('{"error":{"message":"also no"}}')).toBe("also no");
    expect(errorWords('{"code":"x","message":"third"}')).toBe("third");
    expect(errorWords("  plain text  ")).toBe("plain text");
  });
});
