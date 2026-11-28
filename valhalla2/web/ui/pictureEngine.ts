// What the page says about a companion's picture engine: what a picture costs, and the one-line
// summary of its picture settings.
import {
  GROK_PICTURE_PRICES,
  PICTURE_ENGINE_LABELS,
  pictureEngineOf,
  samplerLabel,
  type OpenAiQuality,
  type PictureEngineId,
  type Settings,
} from "../../shared/protocol.ts";

/** What one Grok Imagine picture costs, as the page says it: "about 4¢". */
export const grokPriceNote = (): string => {
  const price = GROK_PICTURE_PRICES["grok-imagine-image-2.0"];
  return price === undefined ? "" : `about ${Math.round(price * 100)}¢`;
};

/**
 * What an OpenAI picture costs, as the page says it. OpenAI bills by tokens and publishes no price
 * per picture, so this is a guide only; the cost under each picture is what it actually used.
 */
export const OPENAI_PRICE_NOTE: Readonly<Record<OpenAiQuality, string>> = {
  low: "about 1¢",
  medium: "about 5¢",
  high: "about 20¢",
  auto: "between about 1¢ and 20¢",
};

/** The one-line summary of a companion's picture settings, for its folded Pictures section. */
export function pictureSummary(settings: Settings, available: readonly PictureEngineId[]): string {
  const engine = pictureEngineOf(settings.pictureEngine, available) ?? settings.pictureEngine;
  if (engine === "grok") {
    return `${PICTURE_ENGINE_LABELS.grok} · ${settings.grokPictureQuality} quality · ${settings.grokPictureResolution}`;
  }
  if (engine === "openai") return `${PICTURE_ENGINE_LABELS.openai} · ${settings.openaiPictureQuality} quality`;
  const seed = settings.pictureSeed === null ? "" : ` · seed ${settings.pictureSeed}`;
  const name = available.length > 1 ? `${PICTURE_ENGINE_LABELS.civitai} · ` : "";
  return `${name}${samplerLabel(settings.pictureSampler)} ·${settings.pictureSteps} steps · CFG ${settings.pictureCfg}${seed}`;
}
