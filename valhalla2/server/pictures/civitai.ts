// The one place Valhalla 2 talks to CivitAI, which makes the pictures.
//
// A picture is a "workflow" on CivitAI's orchestration API: submitted once, then looked at until
// it has finished, then its image is downloaded from the address it names. Submitting and looking
// are separate, so a picture the server was stopped in the middle of can be picked up again from
// the workflow's id.

import { DEFAULT_SETTINGS, isCivitaiParams, type Settings } from "../../shared/protocol.ts";
import { EngineError, type PictureEngine, type PictureOrder } from "./engine.ts";

const API = "https://orchestration.civitai.com/v2/consumer/workflows";

/** One picture to make. */
export interface PictureJob {
  model: string;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  cfgScale: number;
  /** CivitAI's spelling of the sampler: euler_a, dpm++2m… */
  sampleMethod: string;
  clipSkip: number;
  seed: number;
}

export interface Workflow {
  id: string;
  status: string;
  steps?: { output?: { images?: { url?: string }[]; blobs?: { url?: string }[] } }[];
}

/** A picture that CivitAI refused, failed to make, or took too long over. */
export class CivitaiError extends EngineError {}

const FINISHED = new Set(["succeeded", "failed", "expired", "canceled"]);

/** The type and file ending of an image, from its first bytes; null for anything else. */
export function sniffImage(head: Uint8Array): { type: string; ext: string } | null {
  const ascii = (start: number, text: string) => [...text].every((c, i) => head[start + i] === c.charCodeAt(0));
  if (head[0] === 0x89 && ascii(1, "PNG\r\n\x1a\n")) return { type: "image/png", ext: "png" };
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { type: "image/jpeg", ext: "jpg" };
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return { type: "image/webp", ext: "webp" };
  return null;
}

/** What CivitAI said when it refused a request: its messages, when it lists them, or the start of its answer. */
export function refusalOf(text: string): string {
  try {
    const answer = JSON.parse(text) as { errors?: { messages?: unknown } };
    const messages = answer.errors?.messages;
    if (Array.isArray(messages) && messages.length > 0) return messages.map(String).join(" ");
  } catch {
    // Not JSON: shown as it is.
  }
  return text.slice(0, 500);
}

/** The addresses of a finished workflow's images. */
export const imagesOf = (workflow: Workflow): string[] =>
  (workflow.steps ?? []).flatMap((step) =>
    (step.output?.images ?? step.output?.blobs ?? []).flatMap((image) => (image.url ? [image.url] : [])),
  );

/**
 * A seed for a new picture: always ten digits, from 1,000,000,000 to 4,294,967,295, so it also
 * fits anything that reads a seed as an unsigned 32-bit number.
 */
export const SEED_MIN = 1_000_000_000;
export const SEED_MAX = 2 ** 32 - 1;
export const randomSeed = (): number => SEED_MIN + Math.floor(Math.random() * (SEED_MAX - SEED_MIN + 1));

export interface CivitaiOptions {
  token: string;
  fetch?: typeof fetch;
  /** How long to wait between looks at a workflow. */
  pollMs?: number;
  /** How long a picture may take, from when it is first looked at. */
  deadlineMs?: number;
  /** How long one request may take. */
  requestMs?: number;
  /** The largest image accepted, in bytes. */
  maxBytes?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function createCivitai(options: CivitaiOptions) {
  const {
    token,
    fetch: get = globalThis.fetch,
    pollMs = 3_000,
    deadlineMs = 5 * 60_000,
    requestMs = 90_000,
    maxBytes = 20 * 1024 * 1024,
    sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
  } = options;

  async function call(url: string, init: RequestInit = {}): Promise<Workflow> {
    let res: Response;
    try {
      res = await get(url, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(requestMs),
      });
    } catch (err) {
      throw new CivitaiError(`CivitAI can't be reached: ${(err as Error).message}`);
    }
    const text = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw new CivitaiError("CivitAI refused the server's API key. Whoever runs this Valhalla 2 needs to check it.");
    }
    if (!res.ok) throw new CivitaiError(`CivitAI answered ${res.status}: ${refusalOf(text)}`);
    try {
      return JSON.parse(text) as Workflow;
    } catch {
      throw new CivitaiError("CivitAI sent back something that isn't JSON");
    }
  }

  const body = (job: PictureJob) =>
    JSON.stringify({
      steps: [
        {
          $type: "imageGen",
          input: { engine: "sdcpp", ecosystem: "sdxl", operation: "createImage", quantity: 1, ...job },
        },
      ],
    });

  return {
    /** Asks for a picture. CivitAI holds the answer up to a minute, so it is often already done. */
    submit(job: PictureJob): Promise<Workflow> {
      return call(`${API}?wait=60`, { method: "POST", body: body(job) });
    },

    /**
     * What a picture would cost, in Buzz, asked without making it (null when CivitAI doesn't say).
     * Refused, as a submission would be, when CivitAI won't make it: a checkpoint it can't run.
     */
    async estimate(job: PictureJob): Promise<number | null> {
      const answer = (await call(`${API}?whatif=true`, { method: "POST", body: body(job) })) as Workflow & {
        transactions?: { list?: { type?: string; amount?: number }[] };
      };
      const debits = (answer.transactions?.list ?? []).filter(
        (entry) => entry.type === "debit" && typeof entry.amount === "number",
      );
      return debits.length > 0 ? debits.reduce((sum, entry) => sum + entry.amount!, 0) : null;
    },

    /** Looks at a workflow until it has finished, and returns its image's address. */
    async finish(first: Workflow | string): Promise<string> {
      let workflow = typeof first === "string" ? await call(`${API}/${first}`) : first;
      const deadline = Date.now() + deadlineMs;
      while (!FINISHED.has(workflow.status)) {
        if (Date.now() > deadline) throw new CivitaiError(`CivitAI took too long (still ${workflow.status})`);
        await sleep(pollMs);
        workflow = await call(`${API}/${workflow.id}`);
      }
      if (workflow.status !== "succeeded")
        throw new CivitaiError(`CivitAI didn't make the picture: ${workflow.status}`);
      const url = imagesOf(workflow)[0];
      if (!url) throw new CivitaiError("CivitAI finished but sent no picture");
      return url;
    },

    /** Downloads an image, refusing anything too large or that isn't a PNG, JPEG or WebP. */
    async download(url: string): Promise<{ bytes: Uint8Array; type: string; ext: string }> {
      let res: Response;
      try {
        res = await get(url, { signal: AbortSignal.timeout(requestMs) });
      } catch (err) {
        throw new CivitaiError(`The picture couldn't be downloaded: ${(err as Error).message}`);
      }
      if (!res.ok) throw new CivitaiError(`The picture couldn't be downloaded: ${res.status}`);
      const length = Number(res.headers.get("content-length") ?? 0);
      if (length > maxBytes) throw new CivitaiError("The picture is larger than Valhalla 2 keeps");
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > maxBytes) throw new CivitaiError("The picture is larger than Valhalla 2 keeps");
      const kind = sniffImage(bytes.subarray(0, 16));
      if (!kind) throw new CivitaiError("CivitAI sent back something that isn't a picture");
      return { bytes, ...kind };
    },
  };
}

export type Civitai = ReturnType<typeof createCivitai>;

/**
 * The CivitAI job for a kept picture. One asked for before the sampler and clip skip could be
 * chosen gets what a new companion starts with.
 */
export function jobFor({ prompt, negativePrompt, params }: PictureOrder): PictureJob {
  if (!isCivitaiParams(params)) throw new CivitaiError("This picture is for another engine, not CivitAI");
  const { sampler, clipSkip, engine: _engine, modelName: _name, ...rest } = params;
  return {
    prompt,
    negativePrompt,
    ...rest,
    sampleMethod: sampler ?? DEFAULT_SETTINGS.pictureSampler,
    clipSkip: clipSkip ?? DEFAULT_SETTINGS.pictureClipSkip,
  };
}

/** What the prompt writer is told about the checkpoint, so it writes in the words it expects. */
export function checkpointNote({ pictureModel, pictureModelName, pictureBaseModel }: Settings): string {
  const base = pictureBaseModel ? ` (base model: ${pictureBaseModel})` : "";
  return (
    `The picture is made on the SDXL checkpoint ${pictureModelName || pictureModel}${base}. ` +
    "Write the prompt in the words and quality tags it expects."
  );
}

/** CivitAI as a picture engine: the companion's SDXL checkpoint, read in tags or in sentences. */
export function civitaiEngine(civitai: Civitai): PictureEngine {
  return {
    id: "civitai",
    instructionsFor: (settings) => ({
      key: settings.picturePromptStyle === "sentences" ? "civitaiSentencesPicture" : "picture",
      note: checkpointNote(settings),
    }),
    takesNegative: true,
    submit: async (order) => ({ job: await civitai.submit(jobFor(order)) }),
    // A job it answered is a workflow; the painter only ever hands back what submit gave it.
    finish: (job) => civitai.finish(typeof job === "string" ? job : (job as Workflow)),
    download: (url) => civitai.download(url),
  };
}
