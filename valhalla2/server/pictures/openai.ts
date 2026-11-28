// The one place Valhalla 2 asks OpenAI's image model for a picture.
//
// One POST of the prompt, one picture back in the same answer (as base64: OpenAI's image models
// return nothing else). It runs on the same OpenAI key GPT companions answer with
// (../openai/key.ts). The model reads plain sentences, and has no seed or negative prompt: only the
// size, which follows the picture's orientation, and the quality. OpenAI bills a picture by
// tokens, and says how many it used, so what it cost is worked out from that.
//
// It is asked with `moderation: "low"`, OpenAI's less restrictive filtering: Valhalla 2 adds no
// filter of its own, and asks the API for as little as it allows.
import { isOpenAiParams, OPENAI_PICTURE_PRICES, type OpenAiQuality } from "../../shared/protocol.ts";
import { sniffImage } from "./civitai.ts";
import { EngineError, type MadeImage, type PictureEngine } from "./engine.ts";
import { errorWords } from "./grok.ts";

const API = "https://api.openai.com/v1/images/generations";

/** A picture that OpenAI refused or failed to make. */
export class OpenAiImagesError extends EngineError {}

/** One picture to make. */
export interface OpenAiImage {
  model: string;
  prompt: string;
  /** As OpenAI spells it: 1024x1536, 1536x1024, 1024x1024. */
  size: string;
  quality: OpenAiQuality;
}

export interface OpenAiImagesOptions {
  apiKey: string;
  fetch?: typeof fetch;
  /** How long one request may take: the picture is made within it. */
  requestMs?: number;
  /** The largest image accepted, in bytes. */
  maxBytes?: number;
}

/** The body of the request for one picture. */
export function bodyFor({ model, prompt, size, quality }: OpenAiImage): Record<string, unknown> {
  return {
    model,
    prompt,
    n: 1,
    size,
    quality,
    output_format: "jpeg",
    output_compression: 90,
    moderation: "low",
  };
}

/** What OpenAI reports a picture used, as its answer spells it. */
export interface ImageUsage {
  input_tokens_details?: { text_tokens?: unknown; image_tokens?: unknown };
  output_tokens?: unknown;
}

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;

/** What a picture cost in dollars, from the tokens it used; null for a model whose prices aren't known. */
export function costOf(model: string, usage: ImageUsage | undefined): number | null {
  const price = OPENAI_PICTURE_PRICES[model];
  if (!price || !usage) return null;
  const text = count(usage.input_tokens_details?.text_tokens);
  const image = count(usage.input_tokens_details?.image_tokens);
  const output = count(usage.output_tokens);
  return (text * price.text + image * price.image + output * price.output) / 1_000_000;
}

/** Whether an error answer is OpenAI's filter refusing the prompt. */
const blocked = (text: string): boolean => {
  try {
    const raw = JSON.parse(text) as { error?: { code?: unknown } };
    return raw.error?.code === "moderation_blocked";
  } catch {
    return false;
  }
};

export function createOpenAiImages(options: OpenAiImagesOptions) {
  const { apiKey, fetch: get = globalThis.fetch, requestMs = 180_000, maxBytes = 20 * 1024 * 1024 } = options;

  return {
    /** Makes one picture and returns it, with what it cost. */
    async generate(image: OpenAiImage): Promise<MadeImage> {
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
        throw new OpenAiImagesError(`OpenAI can't be reached: ${reason}`);
      }
      const text = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) {
        throw new OpenAiImagesError(
          "OpenAI refused the server's key. Whoever runs this Valhalla 2 needs to check the OpenAI key.",
        );
      }
      if (res.status === 429) {
        throw new OpenAiImagesError("OpenAI is busy (too many requests at once). Try again in a moment.");
      }
      if (res.status === 400 && blocked(text)) {
        throw new OpenAiImagesError(
          "OpenAI's filter refused this prompt. Change the prompt, or make this picture with another engine.",
        );
      }
      if (res.status === 400 || res.status === 422) {
        const words = errorWords(text);
        throw new OpenAiImagesError(`OpenAI refused this prompt${words ? `: ${words}` : ""}`);
      }
      if (!res.ok) {
        const words = errorWords(text);
        throw new OpenAiImagesError(`OpenAI answered ${res.status}${words ? `: ${words}` : ""}`);
      }
      let raw: { data?: { b64_json?: unknown }[]; usage?: ImageUsage };
      try {
        raw = JSON.parse(text);
      } catch {
        throw new OpenAiImagesError("OpenAI sent back something that isn't JSON");
      }
      const b64 = raw.data?.[0]?.b64_json;
      if (typeof b64 !== "string" || !b64) throw new OpenAiImagesError("OpenAI finished but sent no picture");
      // Base64 is a third larger than the bytes it holds: refuse an oversized one before decoding it.
      if (b64.length * 0.75 > maxBytes) throw new OpenAiImagesError("The picture is larger than Valhalla 2 keeps");
      const bytes = new Uint8Array(Buffer.from(b64, "base64"));
      const kind = sniffImage(bytes.subarray(0, 16));
      if (!kind) throw new OpenAiImagesError("OpenAI sent back something that isn't a picture");
      return { bytes, ...kind, cost: costOf(image.model, raw.usage) };
    },
  };
}

export type OpenAiImages = ReturnType<typeof createOpenAiImages>;

/** OpenAI's image model as a picture engine: plain sentences, and the picture within the one request. */
export function openAiImagesEngine(openai: OpenAiImages): PictureEngine {
  const never = (): never => {
    throw new OpenAiImagesError("OpenAI has no job to wait for");
  };
  return {
    id: "openai",
    instructionsFor: () => ({ key: "openaiPicture", note: null }),
    takesNegative: false,
    async submit({ prompt, params }) {
      if (!isOpenAiParams(params)) throw new OpenAiImagesError("This picture is for another engine, not OpenAI");
      const { model, size, quality } = params;
      return { image: await openai.generate({ model, prompt, size, quality }) };
    },
    finish: never,
    download: never,
  };
}
