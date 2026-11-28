// The one place Valhalla 2 asks Grok Imagine, xAI's image model, for a picture.
//
// One POST of the prompt, one picture back in the same answer (as base64, so there is no temporary
// address to download from in time). It runs on the same xAI key Grok companions answer with
// (../grok/key.ts). Grok Imagine reads plain sentences, and has no seed, negative prompt, steps or
// CFG: only the shape, the size and the quality.
import { isGrokParams, type GrokQuality, type GrokResolution } from "../../shared/protocol.ts";
import { sniffImage } from "./civitai.ts";
import { EngineError, type MadeImage, type PictureEngine } from "./engine.ts";

const API = "https://api.x.ai/v1/images/generations";

/** xAI counts money in ticks: one US cent is 100,000,000 of them. */
const TICKS_PER_DOLLAR = 10_000_000_000;

/** A picture that Grok Imagine refused or failed to make. */
export class GrokImagineError extends EngineError {}

/** One picture to make. */
export interface GrokImage {
  model: string;
  prompt: string;
  /** As xAI spells it: 2:3, 3:2, 1:1. */
  aspectRatio: string;
  resolution: GrokResolution;
  quality: GrokQuality;
}

export interface GrokImagineOptions {
  apiKey: string;
  fetch?: typeof fetch;
  /** How long one request may take: the picture is made within it. */
  requestMs?: number;
  /** The largest image accepted, in bytes. */
  maxBytes?: number;
}

/** Only Grok Imagine 2.0 takes a quality; the older model refuses one. */
export const takesQuality = (model: string): boolean => model.startsWith("grok-imagine-image-2");

/** The body of the request for one picture. */
export function bodyFor({ model, prompt, aspectRatio, resolution, quality }: GrokImage): Record<string, unknown> {
  return {
    model,
    prompt,
    n: 1,
    aspect_ratio: aspectRatio,
    resolution,
    ...(takesQuality(model) ? { quality } : {}),
    response_format: "b64_json",
  };
}

/** The words of an xAI error answer: its `error` (a string or an object with a message), or the text. */
export function errorWords(text: string): string {
  try {
    const raw = JSON.parse(text) as { error?: unknown; message?: unknown; code?: unknown };
    const error = raw.error as { message?: unknown } | string | undefined;
    if (typeof error === "string" && error.trim()) return error.trim().slice(0, 300);
    if (error && typeof error === "object" && typeof error.message === "string") return error.message.slice(0, 300);
    if (typeof raw.message === "string") return raw.message.slice(0, 300);
  } catch {
    // Not JSON: the text itself.
  }
  return text.trim().slice(0, 300);
}

export function createGrokImagine(options: GrokImagineOptions) {
  const { apiKey, fetch: get = globalThis.fetch, requestMs = 120_000, maxBytes = 20 * 1024 * 1024 } = options;

  return {
    /** Makes one picture and returns it, with what it cost. */
    async generate(image: GrokImage): Promise<MadeImage> {
      let res: Response;
      try {
        res = await get(API, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "User-Agent": "valhalla2" },
          body: JSON.stringify(bodyFor(image)),
          signal: AbortSignal.timeout(requestMs),
        });
      } catch (err) {
        const reason = (err as Error).name === "TimeoutError" ? "it took too long to answer" : (err as Error).message;
        throw new GrokImagineError(`Grok Imagine can't be reached: ${reason}`);
      }
      const text = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) {
        throw new GrokImagineError(
          "xAI refused the server's key. Whoever runs this Valhalla 2 needs to check the xAI key.",
        );
      }
      if (res.status === 429) {
        throw new GrokImagineError("Grok Imagine is busy (too many requests at once). Try again in a moment.");
      }
      if (res.status === 400 || res.status === 422) {
        const words = errorWords(text);
        throw new GrokImagineError(
          `Grok Imagine refused this prompt${words ? `: ${words}` : ""}. xAI may still charge for it. Change the prompt and try again.`,
        );
      }
      if (!res.ok) {
        const words = errorWords(text);
        throw new GrokImagineError(`Grok Imagine answered ${res.status}${words ? `: ${words}` : ""}`);
      }
      let raw: { data?: { b64_json?: unknown }[]; usage?: { cost_in_usd_ticks?: unknown } };
      try {
        raw = JSON.parse(text);
      } catch {
        throw new GrokImagineError("Grok Imagine sent back something that isn't JSON");
      }
      const b64 = raw.data?.[0]?.b64_json;
      if (typeof b64 !== "string" || !b64) throw new GrokImagineError("Grok Imagine finished but sent no picture");
      // Base64 is a third larger than the bytes it holds: refuse an oversized one before decoding it.
      if (b64.length * 0.75 > maxBytes) throw new GrokImagineError("The picture is larger than Valhalla 2 keeps");
      const bytes = new Uint8Array(Buffer.from(b64, "base64"));
      const kind = sniffImage(bytes.subarray(0, 16));
      if (!kind) throw new GrokImagineError("Grok Imagine sent back something that isn't a picture");
      const ticks = raw.usage?.cost_in_usd_ticks;
      const cost = typeof ticks === "number" && Number.isFinite(ticks) && ticks >= 0 ? ticks / TICKS_PER_DOLLAR : null;
      return { bytes, ...kind, cost };
    },
  };
}

export type GrokImagine = ReturnType<typeof createGrokImagine>;

/** Grok Imagine as a picture engine: plain sentences, and the picture within the one request. */
export function grokImagineEngine(grok: GrokImagine): PictureEngine {
  const never = (): never => {
    throw new GrokImagineError("Grok Imagine has no job to wait for");
  };
  return {
    id: "grok",
    promptStyle: "natural",
    async submit({ prompt, params }) {
      if (!isGrokParams(params)) throw new GrokImagineError("This picture is for CivitAI, not Grok Imagine");
      const { model, aspectRatio, resolution, quality } = params;
      return { image: await grok.generate({ model, prompt, aspectRatio, resolution, quality }) };
    },
    finish: never,
    download: never,
  };
}
