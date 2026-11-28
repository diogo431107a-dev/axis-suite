// Pictures of a companion: their kinds, sizes, prompts and parameters.
import type { SceneView } from "./scene.ts";

/** Profile pictures are made from the companion page; chat pictures from a message. */
export const PICTURE_KINDS = ["profile", "chat"] as const;
export type PictureKind = (typeof PICTURE_KINDS)[number];

export const ORIENTATIONS = ["portrait", "landscape", "square"] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

/**
 * What makes the pictures: CivitAI (an SDXL checkpoint, read in Danbooru tags), Grok Imagine (xAI's
 * image model) or OpenAI's image model, both read in plain sentences. Each companion chooses one.
 */
export const PICTURE_ENGINES = ["civitai", "grok", "openai"] as const;
export type PictureEngineId = (typeof PICTURE_ENGINES)[number];
export const PICTURE_ENGINE_LABELS: Readonly<Record<PictureEngineId, string>> = {
  civitai: "CivitAI",
  grok: "Grok Imagine",
  openai: "OpenAI",
};

/** The shape Grok Imagine is asked for, one per orientation: close to SDXL's sizes below. */
export const GROK_ASPECT: Readonly<Record<Orientation, string>> = {
  portrait: "2:3",
  landscape: "3:2",
  square: "1:1",
};

/** Grok Imagine's quality: auto is xAI's own choice (low, for a new picture). */
export const GROK_QUALITIES = ["auto", "low", "medium"] as const;
export type GrokQuality = (typeof GROK_QUALITIES)[number];

/** Grok Imagine's size: about a thousand or two thousand pixels on the long side. */
export const GROK_RESOLUTIONS = ["1k", "2k"] as const;
export type GrokResolution = (typeof GROK_RESOLUTIONS)[number];

/** What xAI charges for one picture of its image model, in dollars, as published on 2026-11-28. */
export const GROK_PICTURE_PRICES: Readonly<Record<string, number>> = {
  "grok-imagine-image-2.0": 0.04,
  "grok-imagine-image": 0.02,
};

/** The size OpenAI's image model is asked for, one per orientation: the three it makes. */
export const OPENAI_SIZES: Readonly<Record<Orientation, string>> = {
  portrait: "1024x1536",
  landscape: "1536x1024",
  square: "1024x1024",
};

/** OpenAI's quality: dearer and finer from low to high; auto is OpenAI's own choice. */
export const OPENAI_QUALITIES = ["low", "medium", "high", "auto"] as const;
export type OpenAiQuality = (typeof OPENAI_QUALITIES)[number];

/**
 * What OpenAI charges for its image model, in dollars per million tokens, as published on
 * 2026-11-28. It bills a picture by tokens: the prompt's text in, the picture out.
 */
export const OPENAI_PICTURE_PRICES: Readonly<Record<string, { text: number; image: number; output: number }>> = {
  "gpt-image-2.6-flare": { text: 5, image: 8, output: 30 },
  "gpt-image-2.6-sunburst": { text: 5, image: 8, output: 30 },
};

/** The sizes SDXL was trained on, one per orientation. */
export const PICTURE_SIZES: Readonly<Record<Orientation, { width: number; height: number }>> = {
  portrait: { width: 832, height: 1216 },
  landscape: { width: 1216, height: 832 },
  square: { width: 1024, height: 1024 },
};

/**
 * The samplers CivitAI's SDXL engine takes, as it spells them, with a label for the page. Checked
 * with a whatif submission on 2026-11-28. The DPM++ ones cost a little more Buzz.
 */
export const SAMPLERS = [
  { id: "euler_a", label: "Euler a" },
  { id: "euler", label: "Euler" },
  { id: "dpm++2m", label: "DPM++ 2M" },
  { id: "dpm++2mv2", label: "DPM++ 2M v2" },
  { id: "dpm++2s_a", label: "DPM++ 2S a" },
  { id: "heun", label: "Heun" },
  { id: "dpm2", label: "DPM2" },
  { id: "ipndm", label: "iPNDM" },
  { id: "ipndm_v", label: "iPNDM v" },
  { id: "ddim_trailing", label: "DDIM trailing" },
  { id: "lcm", label: "LCM" },
  { id: "tcd", label: "TCD" },
  { id: "res_multistep", label: "Res multistep" },
  { id: "res_2s", label: "Res 2S" },
] as const;
export type Sampler = (typeof SAMPLERS)[number]["id"];
export const SAMPLER_IDS: readonly Sampler[] = SAMPLERS.map((entry) => entry.id);
export const samplerLabel = (id: string): string => SAMPLERS.find((entry) => entry.id === id)?.label ?? id;

/**
 * How a CivitAI picture's prompt is written: in Danbooru tags, which anime checkpoints read best, or
 * in plain sentences, for checkpoints trained on them.
 */
export const PROMPT_STYLES = ["tags", "sentences"] as const;
export type PromptStyle = (typeof PROMPT_STYLES)[number];
export const PROMPT_STYLE_LABELS: Readonly<Record<PromptStyle, string>> = {
  tags: "Danbooru tags",
  sentences: "Plain sentences",
};

/**
 * The base models CivitAI names for the SDXL family, the only one Valhalla 2 makes pictures on: its
 * sizes, samplers, clip skip and negative prompt all fit SDXL.
 */
export const SDXL_BASE_MODELS: readonly string[] = [
  "SDXL 1.0",
  "SDXL 0.9",
  "SDXL Lightning",
  "SDXL Hyper",
  "SDXL Turbo",
  "SDXL Distilled",
  "Pony",
  "Illustrious",
  "NoobAI",
];

/** The base models whose checkpoints read Danbooru tags best. */
export const TAG_BASE_MODELS: readonly string[] = ["Pony", "Illustrious", "NoobAI"];

/** The prompt style a checkpoint is guessed to want, from its base model. */
export const styleFor = (baseModel: string): PromptStyle =>
  TAG_BASE_MODELS.includes(baseModel) ? "tags" : "sentences";

/** The checkpoint a companion's CivitAI pictures are made on, as CivitAI names it. */
export interface Checkpoint {
  /** As CivitAI's orchestration API takes it: urn:air:sdxl:checkpoint:civitai:827184@2883731. */
  air: string;
  /** The model and the version: WAI-illustrious-SDXL v17.0. */
  name: string;
  /** Illustrious, Pony, SDXL 1.0… */
  baseModel: string;
  /** The prompt style guessed from the base model. */
  style: PromptStyle;
}

/** What looking a checkpoint up answers: it, and what CivitAI says one picture on it costs. */
export interface CheckpointLookup extends Checkpoint {
  /** In Buzz, at the companion's steps and sampler; null when CivitAI doesn't say. */
  buzz: number | null;
}

/** The shape of an SDXL checkpoint's AIR, the only kind a companion may choose. */
export const SDXL_CHECKPOINT_AIR = /^urn:air:sdxl:checkpoint:civitai:\d+@\d+$/;

/** A picture's prompt, written by the companion's API and yours to change before the picture is made. */
export interface PictureDraft {
  prompt: string;
  negativePrompt: string;
  orientation: Orientation;
  /** One plain line saying what the picture shows, for the gallery. */
  caption: string;
}

/** What writing a prompt answers: the draft, and what asking Claude for it cost. */
export interface PictureDraftReply extends PictureDraft {
  /** In dollars, at the published prices; null when a price is unknown. */
  cost: number | null;
  /** The moment as it was worked out, for a chat picture. */
  scene: SceneView | null;
}

/** What a CivitAI picture is made from, besides its prompt. */
export interface CivitaiParams {
  /** Absent on pictures made before there was a second engine. */
  engine?: "civitai";
  /** The checkpoint's AIR. */
  model: string;
  /** The checkpoint's name; absent on pictures made before it could be chosen, or when unknown. */
  modelName?: string;
  width: number;
  height: number;
  steps: number;
  cfgScale: number;
  seed: number;
  /** Absent on pictures made before they could be chosen (CivitAI's own default then). */
  sampler?: Sampler;
  clipSkip?: number;
}

/** What a Grok Imagine picture is made from, besides its prompt. It has no seed. */
export interface GrokPictureParams {
  engine: "grok";
  model: string;
  /** As xAI spells it: 2:3, 3:2, 1:1. */
  aspectRatio: string;
  resolution: GrokResolution;
  quality: GrokQuality;
}

/** What an OpenAI picture is made from, besides its prompt. It has no seed. */
export interface OpenAiPictureParams {
  engine: "openai";
  model: string;
  /** As OpenAI spells it: 1024x1536, 1536x1024, 1024x1024. */
  size: string;
  quality: OpenAiQuality;
}

/** What a picture is made from, besides its prompt: tell them apart by `engine`. */
export type PictureParams = CivitaiParams | GrokPictureParams | OpenAiPictureParams;

/** Whether a picture's parameters are Grok Imagine's. */
export const isGrokParams = (params: PictureParams): params is GrokPictureParams => params.engine === "grok";

/** Whether a picture's parameters are OpenAI's. */
export const isOpenAiParams = (params: PictureParams): params is OpenAiPictureParams => params.engine === "openai";

/** Whether a picture's parameters are CivitAI's: those made before there were engines have none. */
export const isCivitaiParams = (params: PictureParams): params is CivitaiParams =>
  params.engine === undefined || params.engine === "civitai";

/** A picture of a companion, made or being made. Its file is GET /api/pictures/:id/file. */
export interface Picture extends PictureDraft {
  id: string;
  companionId: string;
  kind: PictureKind;
  /** The chat and message a chat picture was made from; null once that chat is deleted. */
  chatId: string | null;
  chatTitle: string | null;
  messageId: number | null;
  params: PictureParams;
  /** The engine that makes it. */
  engine: PictureEngineId;
  /** What making it cost, in dollars, when the engine says; null for CivitAI (it charges Buzz). */
  cost: number | null;
  status: "working" | "done" | "failed";
  error: string | null;
  createdAt: string;
}

/**
 * The engine a companion's pictures are made by: its own choice, or, when the server has no key
 * for that one, the one it has. Null when it has none.
 */
export const pictureEngineOf = (
  chosen: PictureEngineId,
  available: readonly PictureEngineId[],
): PictureEngineId | null => (available.includes(chosen) ? chosen : (available[0] ?? null));
