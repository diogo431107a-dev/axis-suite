import { describe, expect, it } from "vitest";
import {
  CivitaiError,
  createCivitai,
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

  it("tells PNG, JPEG and WebP apart from anything else", () => {
    expect(sniffImage(PNG)?.ext).toBe("png");
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.ext).toBe("jpg");
    expect(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))?.ext).toBe("webp");
    expect(sniffImage(new TextEncoder().encode("GIF89a"))).toBeNull();
    expect(imagesOf({ id: "x", status: "succeeded" })).toEqual([]);
  });
});
