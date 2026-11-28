// What a new picture is made with, besides its prompt: each engine's own settings, from the
// companion's, for the shape asked for. Kept with the picture, so it can be made again as it was.
import {
  GROK_ASPECT,
  OPENAI_SIZES,
  PICTURE_SIZES,
  type Orientation,
  type PictureEngineId,
  type PictureParams,
  type Settings,
} from "../../shared/protocol.ts";
import { config } from "../config.ts";

/** The params for a picture on `engine`. `seed` is CivitAI's, the only engine that takes one. */
export function paramsFor(
  engine: PictureEngineId,
  settings: Settings,
  orientation: Orientation,
  seed: number | null,
): PictureParams {
  switch (engine) {
    case "grok":
      return {
        engine: "grok",
        model: config.pictures.grokModel,
        aspectRatio: GROK_ASPECT[orientation],
        resolution: settings.grokPictureResolution,
        quality: settings.grokPictureQuality,
      };
    case "openai":
      return {
        engine: "openai",
        model: config.pictures.openaiModel,
        size: OPENAI_SIZES[orientation],
        quality: settings.openaiPictureQuality,
      };
    case "civitai":
      if (seed === null) throw new Error("A CivitAI picture needs a seed");
      return {
        model: settings.pictureModel,
        ...(settings.pictureModelName ? { modelName: settings.pictureModelName } : {}),
        ...PICTURE_SIZES[orientation],
        steps: settings.pictureSteps,
        cfgScale: settings.pictureCfg,
        sampler: settings.pictureSampler,
        clipSkip: settings.pictureClipSkip,
        seed,
      };
  }
}
