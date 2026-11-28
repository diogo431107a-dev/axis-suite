import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../shared/protocol.ts";
import { paramsFor } from "./params.ts";
import {
  CivitaiError,
  civitaiEngine,
  createCivitai,
  jobFor,
  imagesOf,
  randomSeed,
  SEED_MAX,
  SEED_MIN,
  sniffImage,
  type PictureJob,
} from "./civitai.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);

const job: PictureJob = {
  model: "urn:air:sdxl:checkpoint:civitai:1@2",
  prompt: "1girl, solo",
  negativePrompt: "bad quality",
  width: 832,
  height: 1216,
  steps: 20,
  cfgScale: 7,
  sampleMethod: "euler_a",
  clipSkip: 2,
  seed: 4_294_967_295,
};

/** A fake CivitAI: answers each request with the next of `answers`, and remembers what it was asked. */
function fake(...answers: (Response | Error)[]) {
  const asked: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = ((url: string, init?: RequestInit) => {
    asked.push({ url, init });
    const next = answers.shift();
    if (!next) return Promise.reject(new Error("Nothing more to answer"));
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }) as typeof globalThis.fetch;
  const civitai = createCivitai({ token: "secret", fetch, pollMs: 1, sleep: () => Promise.resolve() });
  return { civitai, asked };
}

const PONY = "urn:air:sdxl:checkpoint:civitai:257749@290640";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("CivitAI", () => {
  it("rolls ten-digit seeds that fit in 32 bits", () => {
    for (let i = 0; i < 1000; i++) {
      const seed = randomSeed();
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(SEED_MIN);
      expect(seed).toBeLessThanOrEqual(SEED_MAX);
      expect(String(seed)).toHaveLength(10);
    }
  });

  it("asks for one picture with the job's settings and the key", async () => {
    const { civitai, asked } = fake(json({ id: "wf-1", status: "processing" }));
    const workflow = await civitai.submit(job);
    expect(workflow.id).toBe("wf-1");
    expect(asked[0]!.url).toBe("https://orchestration.civitai.com/v2/consumer/workflows?wait=60");
    expect((asked[0]!.init!.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    const body = JSON.parse(String(asked[0]!.init!.body));
    expect(body.steps[0].$type).toBe("imageGen");
    expect(body.steps[0].input).toMatchObject({ ...job, engine: "sdcpp", ecosystem: "sdxl", quantity: 1 });
  });

  it("looks again until the picture is done, and names its image", async () => {
    const { civitai, asked } = fake(
      json({ id: "wf-1", status: "processing" }),
      json({ id: "wf-1", status: "succeeded", steps: [{ output: { images: [{ url: "https://img/1.png" }] } }] }),
    );
    await expect(civitai.finish({ id: "wf-1", status: "scheduled" })).resolves.toBe("https://img/1.png");
    expect(asked.map((one) => one.url)).toEqual([
      "https://orchestration.civitai.com/v2/consumer/workflows/wf-1",
      "https://orchestration.civitai.com/v2/consumer/workflows/wf-1",
    ]);
  });

  it("picks a workflow up again by its id", async () => {
    const { civitai } = fake(json({ id: "wf-2", status: "succeeded", steps: [{ output: { blobs: [{ url: "b" }] } }] }));
    await expect(civitai.finish("wf-2")).resolves.toBe("b");
  });

  it("says so when the picture failed or took too long", async () => {
    await expect(fake().civitai.finish({ id: "x", status: "failed" })).rejects.toThrow(/failed/);
    const slow = createCivitai({
      token: "t",
      fetch: (() => Promise.resolve(json({ id: "x", status: "processing" }))) as typeof fetch,
      deadlineMs: -1,
      sleep: () => Promise.resolve(),
    });
    await expect(slow.finish({ id: "x", status: "processing" })).rejects.toThrow(/too long/);
  });

  it("names a refused key plainly, and other errors with CivitAI's words", async () => {
    await expect(fake(json({}, 401)).civitai.submit(job)).rejects.toThrow(/API key/);
    await expect(fake(new Response("no buzz", { status: 400 })).civitai.submit(job)).rejects.toThrow(/400: no buzz/);
    await expect(fake(new Error("offline")).civitai.submit(job)).rejects.toBeInstanceOf(CivitaiError);
  });

  it("downloads only pictures, and not too large ones", async () => {
    const { civitai } = fake(new Response(PNG));
    await expect(civitai.download("u")).resolves.toMatchObject({ type: "image/png", ext: "png" });
    await expect(fake(new Response("<html>")).civitai.download("u")).rejects.toThrow(/isn't a picture/);
    const small = createCivitai({
      token: "t",
      maxBytes: 4,
      fetch: (() => Promise.resolve(new Response(PNG))) as typeof fetch,
    });
    await expect(small.download("u")).rejects.toThrow(/larger/);
  });

  it("asks what a picture would cost without making it, and says when CivitAI won't run the checkpoint", async () => {
    const { civitai, asked } = fake(
      json({ id: "wf-3", status: "unassigned", transactions: { list: [{ type: "debit", amount: 3 }] } }),
      json({ id: "wf-4", status: "unassigned" }),
      json(
        { errors: { messages: ["Resource urn:air:sdxl:checkpoint:civitai:1@9 does not exist or is not valid."] } },
        400,
      ),
    );
    await expect(civitai.estimate(job)).resolves.toBe(3);
    expect(asked[0]!.url).toBe("https://orchestration.civitai.com/v2/consumer/workflows?whatif=true");
    expect(JSON.parse(String(asked[0]!.init!.body)).steps[0].input.model).toBe(job.model);
    await expect(civitai.estimate(job)).resolves.toBeNull();
    await expect(civitai.estimate(job)).rejects.toThrow(/400: Resource .* does not exist or is not valid\.$/);
  });

  it("makes the picture on the checkpoint it was asked on, sending only its AIR", () => {
    const params = paramsFor(
      "civitai",
      { ...DEFAULT_SETTINGS, pictureModel: PONY, pictureModelName: "Pony" },
      "square",
      7,
    );
    const sent = jobFor({ prompt: "p", negativePrompt: "n", params });
    expect(sent.model).toBe(PONY);
    expect(sent).not.toHaveProperty("modelName");
  });

  it("writes its prompts in the companion's style, and names the checkpoint to the writer", () => {
    const engine = civitaiEngine(fake().civitai);
    expect(engine.instructionsFor(DEFAULT_SETTINGS)).toEqual({
      key: "picture",
      note:
        "The picture is made on the SDXL checkpoint WAI-illustrious-SDXL v17.0 (base model: Illustrious). " +
        "Write the prompt in the words and quality tags it expects.",
    });
    const plain = { ...DEFAULT_SETTINGS, pictureModel: PONY, pictureModelName: "", pictureBaseModel: "" };
    expect(engine.instructionsFor({ ...plain, picturePromptStyle: "sentences" })).toEqual({
      key: "civitaiSentencesPicture",
      note: `The picture is made on the SDXL checkpoint ${PONY}. Write the prompt in the words and quality tags it expects.`,
    });
  });

  it("tells PNG, JPEG and WebP apart from anything else", () => {
    expect(sniffImage(PNG)?.ext).toBe("png");
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.ext).toBe("jpg");
    expect(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))?.ext).toBe("webp");
    expect(sniffImage(new TextEncoder().encode("GIF89a"))).toBeNull();
    expect(imagesOf({ id: "x", status: "succeeded" })).toEqual([]);
  });
});
