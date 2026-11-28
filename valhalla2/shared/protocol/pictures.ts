// Pictures of a companion: their kinds, sizes, prompts and parameters.
import type { SceneView } from "./scene.ts";

/** Profile pictures are made from the companion page; chat pictures from a message. */
export const PICTURE_KINDS = ["profile", "chat"] as const;
export type PictureKind = (typeof PICTURE_KINDS)[number];

export const ORIENTATIONS = ["portrait", "landscape", "square"] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

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

/** A picture's prompt, written by Claude and yours to change before the picture is made. */
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

/** What a picture is made from, besides its prompt. */
export interface PictureParams {
  model: string;
  width: number;
  height: number;
  steps: number;
  cfgScale: number;
  seed: number;
  /** Absent on pictures made before they could be chosen (CivitAI's own default then). */
  sampler?: Sampler;
  clipSkip?: number;
}

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
  status: "working" | "done" | "failed";
  error: string | null;
  createdAt: string;
}
