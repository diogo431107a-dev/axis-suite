import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../shared/protocol.ts";
import { config } from "../config.ts";
import { paramsFor } from "./params.ts";

describe("what a new picture is made with", () => {
  it("is CivitAI's size, steps and seed on CivitAI", () => {
    expect(paramsFor("civitai", DEFAULT_SETTINGS, "portrait", 42)).toEqual({
      model: config.pictures.model,
      width: 832,
      height: 1216,
      steps: DEFAULT_SETTINGS.pictureSteps,
      cfgScale: DEFAULT_SETTINGS.pictureCfg,
      sampler: DEFAULT_SETTINGS.pictureSampler,
      clipSkip: DEFAULT_SETTINGS.pictureClipSkip,
      seed: 42,
    });
    expect(() => paramsFor("civitai", DEFAULT_SETTINGS, "portrait", null)).toThrow(/needs a seed/);
  });

  it("is Grok Imagine's shape, size and quality on Grok, with no seed", () => {
    expect(paramsFor("grok", { ...DEFAULT_SETTINGS, grokPictureQuality: "medium" }, "landscape", null)).toEqual({
      engine: "grok",
      model: config.pictures.grokModel,
      aspectRatio: "3:2",
      resolution: "1k",
      quality: "medium",
    });
  });
});
