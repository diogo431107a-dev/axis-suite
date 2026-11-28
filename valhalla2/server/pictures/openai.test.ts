import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, ORIENTATIONS, pictureEngineOf } from "../../shared/protocol.ts";
import { DEFAULT_PROMPTS } from "../../shared/prompts.ts";
import { settings as checkSettings } from "../check.ts";
import { config } from "../config.ts";
import { pictureInstructions } from "../scene/context.ts";
import { costOf, createOpenAiImages, openAiImagesEngine, OpenAiImagesError, type OpenAiImage } from "./openai.ts";
import { paramsFor } from "./params.ts";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

const image: OpenAiImage = {
  model: "gpt-image-2.6-flare",
  prompt: "An anime illustration of a woman with gold hair.",
  size: "1024x1536",
  quality: "medium",
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

const usage = { input_tokens: 120, input_tokens_details: { text_tokens: 120, image_tokens: 0 }, output_tokens: 1584 };
const made = (bytes: Uint8Array) => ({ data: [{ b64_json: b64(bytes) }], usage });

describe("OpenAI's image model", () => {
  it("is asked for one picture, in the size and quality chosen, with the least filtering", async () => {
    const { asked, fetch } = answering(200, made(JPEG));
    await createOpenAiImages({ apiKey: "sk-key", fetch }).generate(image);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.url).toBe("https://api.openai.com/v1/images/generations");
    expect((asked[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer sk-key");
    expect(JSON.parse(String(asked[0]!.init.body))).toEqual({
      model: "gpt-image-2.6-flare",
      prompt: image.prompt,
      n: 1,
      size: "1024x1536",
      quality: "medium",
      output_format: "jpeg",
      output_compression: 90,
      moderation: "low",
    });
  });

  it("answers with the picture and what it cost, from the tokens it used", async () => {
    const { fetch } = answering(200, made(JPEG));
    const picture = await createOpenAiImages({ apiKey: "k", fetch }).generate(image);
    expect(picture).toMatchObject({ bytes: JPEG, type: "image/jpeg", ext: "jpg" });
    // 120 text tokens at $5 and 1584 picture tokens at $30, per million.
    expect(picture.cost).toBeCloseTo((120 * 5 + 1584 * 30) / 1_000_000, 12);
  });

  it("has no cost for a model whose prices aren't known, or without usage", () => {
    expect(costOf("gpt-image-9", usage)).toBeNull();
    expect(costOf("gpt-image-2.6-flare", undefined)).toBeNull();
  });

  it("refuses with OpenAI's own words", async () => {
    const tryWith = (status: number, body: unknown) =>
      createOpenAiImages({ apiKey: "k", fetch: answering(status, body).fetch }).generate(image);
    await expect(tryWith(401, {})).rejects.toThrow(/refused the server's key/);
    await expect(tryWith(429, {})).rejects.toThrow(/busy/);
    await expect(
      tryWith(400, { error: { code: "moderation_blocked", message: "Your request was rejected." } }),
    ).rejects.toThrow(/OpenAI's filter refused this prompt/);
    await expect(tryWith(400, { error: { message: "Invalid size." } })).rejects.toThrow(/Invalid size/);
    await expect(tryWith(200, { data: [{ b64_json: b64(new Uint8Array([1, 2, 3])) }] })).rejects.toThrow(
      /isn't a picture/,
    );
    await expect(tryWith(200, { data: [] })).rejects.toThrow(OpenAiImagesError);
  });

  it("is an engine of its own: plain sentences, no negative prompt, no seed", async () => {
    const engine = openAiImagesEngine(createOpenAiImages({ apiKey: "k", fetch: answering(200, made(JPEG)).fetch }));
    expect(engine).toMatchObject({ id: "openai", promptKey: "openaiPicture", takesNegative: false });
    const params = paramsFor("openai", DEFAULT_SETTINGS, "portrait", null);
    const done = await engine.submit({ prompt: "p", negativePrompt: "", params });
    expect("image" in done && done.image.cost).toBeGreaterThan(0);
    await expect(
      engine.submit({ prompt: "p", negativePrompt: "", params: paramsFor("grok", DEFAULT_SETTINGS, "portrait", null) }),
    ).rejects.toThrow(/not OpenAI/);
  });
});

describe("an OpenAI picture", () => {
  it("is made in the size of its orientation, at the companion's quality, medium to start", () => {
    expect(DEFAULT_SETTINGS.openaiPictureQuality).toBe("medium");
    expect(ORIENTATIONS.map((o) => paramsFor("openai", DEFAULT_SETTINGS, o, null))).toEqual([
      { engine: "openai", model: config.pictures.openaiModel, size: "1024x1536", quality: "medium" },
      { engine: "openai", model: config.pictures.openaiModel, size: "1536x1024", quality: "medium" },
      { engine: "openai", model: config.pictures.openaiModel, size: "1024x1024", quality: "medium" },
    ]);
    expect(config.pictures.openaiModel).toBe("gpt-image-2.6-flare");
  });

  it("takes only OpenAI's qualities", () => {
    expect(checkSettings({ openaiPictureQuality: "high" }).openaiPictureQuality).toBe("high");
    expect(checkSettings({}).openaiPictureQuality).toBe("medium");
    expect(() => checkSettings({ openaiPictureQuality: "2k" })).toThrow(/picture quality/);
  });

  it("is written from its own instructions, not Grok Imagine's", () => {
    const companion = { prompts: {} };
    expect(pictureInstructions(companion, "openaiPicture")).toBe(DEFAULT_PROMPTS.openaiPicture);
    expect(DEFAULT_PROMPTS.openaiPicture).toContain("OpenAI's image model");
    expect(DEFAULT_PROMPTS.openaiPicture).not.toContain("Grok");
    expect(pictureInstructions({ prompts: { openaiPicture: "Watercolour." } }, "openaiPicture")).toBe("Watercolour.");
  });

  it("gives way to another engine when the server has no OpenAI key", () => {
    expect(pictureEngineOf("openai", ["civitai", "grok", "openai"])).toBe("openai");
    expect(pictureEngineOf("openai", ["civitai", "grok"])).toBe("civitai");
  });
});
