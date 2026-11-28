// What makes this companion's pictures, and how: on CivitAI, steps, CFG, sampler, clip skip, and the
// seed the next picture starts from; on Grok Imagine, the quality and the size; on OpenAI, the
// quality. Shown when the server can make pictures; the engine can be chosen when it has keys for
// more than one.
import { Dices } from "lucide-react";
import {
  GROK_QUALITIES,
  GROK_RESOLUTIONS,
  LIMITS,
  OPENAI_QUALITIES,
  PICTURE_ENGINE_LABELS,
  pictureEngineOf,
  SAMPLERS,
  type GrokQuality,
  type GrokResolution,
  type OpenAiQuality,
  type PictureEngineId,
  type Sampler,
  type Settings,
} from "../../shared/protocol.ts";
import { Field, inputStyle } from "../ui/bits.tsx";
import { grokPriceNote, OPENAI_PRICE_NOTE } from "../ui/pictureEngine.ts";
import { rollSeed, seedFrom } from "../ui/seed.ts";

/** The seed field with its dice, for here and for the picture dialog. */
export function SeedInput({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: number | null;
  onChange: (seed: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <span className="flex gap-2">
      <input
        className={`${inputStyle} font-mono`}
        inputMode="numeric"
        value={value ?? ""}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(seedFrom(e.target.value))}
      />
      <button
        type="button"
        className="rounded border border-rule bg-sheet px-2 hover:border-accent disabled:opacity-50"
        title="A new seed"
        aria-label="Roll a new seed"
        disabled={disabled}
        onClick={() => onChange(rollSeed())}
      >
        <Dices size={16} />
      </button>
    </span>
  );
}

const QUALITY_LABELS: Readonly<Record<GrokQuality, string>> = {
  auto: "Auto (xAI's choice: low for a new picture)",
  low: "Low",
  medium: "Medium",
};

const OPENAI_QUALITY_LABELS: Readonly<Record<OpenAiQuality, string>> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  auto: "Auto (OpenAI's choice)",
};

export function PictureSettings({
  settings,
  onChange,
  available,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
  /** The engines the server has keys for. */
  available: readonly PictureEngineId[];
}) {
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value });
  const engine = pictureEngineOf(settings.pictureEngine, available) ?? settings.pictureEngine;
  const choice =
    available.length > 1 ? (
      <Field
        label="Made by"
        hint="CivitAI draws from Danbooru tags on an anime SDXL checkpoint; Grok Imagine (xAI) and OpenAI draw from plain sentences. Each has its own picture instructions."
      >
        <select
          className={inputStyle}
          value={engine}
          onChange={(e) => set("pictureEngine", e.target.value as PictureEngineId)}
        >
          {available.map((id) => (
            <option key={id} value={id}>
              {PICTURE_ENGINE_LABELS[id]}
            </option>
          ))}
        </select>
      </Field>
    ) : null;

  if (engine === "openai") {
    const quality = settings.openaiPictureQuality;
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {choice}
        <Field label="Quality" hint="Higher is finer and slower; OpenAI bills a picture by what it takes to make it.">
          <select
            className={inputStyle}
            value={quality}
            onChange={(e) => set("openaiPictureQuality", e.target.value as OpenAiQuality)}
          >
            {OPENAI_QUALITIES.map((value) => (
              <option key={value} value={value}>
                {OPENAI_QUALITY_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
        <p className="text-sm text-faint sm:col-span-2">
          At this quality a picture costs {OPENAI_PRICE_NOTE[quality]} on the server&apos;s OpenAI account; the exact
          cost is shown under each one. Its size follows the picture&apos;s shape. OpenAI has no seed: every picture is
          drawn afresh, so the profile&apos;s description is what keeps the companion looking alike.
        </p>
      </div>
    );
  }

  if (engine === "grok") {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {choice}
        <Field label="Quality" hint="Medium has finer detail; xAI bills a picture at the quality it is made at.">
          <select
            className={inputStyle}
            value={settings.grokPictureQuality}
            onChange={(e) => set("grokPictureQuality", e.target.value as GrokQuality)}
          >
            {GROK_QUALITIES.map((quality) => (
              <option key={quality} value={quality}>
                {QUALITY_LABELS[quality]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Size" hint="About 1,000 or 2,000 pixels on the long side. 2k is sharper, larger and slower.">
          <select
            className={inputStyle}
            value={settings.grokPictureResolution}
            onChange={(e) => set("grokPictureResolution", e.target.value as GrokResolution)}
          >
            {GROK_RESOLUTIONS.map((resolution) => (
              <option key={resolution} value={resolution}>
                {resolution}
              </option>
            ))}
          </select>
        </Field>
        <p className="text-sm text-faint sm:col-span-2">
          Each picture costs {grokPriceNote()} on the server&apos;s xAI account. Grok Imagine has no seed: every picture
          is drawn afresh, so the profile&apos;s description is what keeps the companion looking alike.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {choice}
      <Field
        label="Steps"
        hint={`${LIMITS.pictureStepsMin}–${LIMITS.pictureStepsMax}. More is finer, slower and costs more Buzz.`}
      >
        <input
          className={inputStyle}
          type="number"
          min={LIMITS.pictureStepsMin}
          max={LIMITS.pictureStepsMax}
          value={settings.pictureSteps}
          onChange={(e) => set("pictureSteps", Number(e.target.value))}
        />
      </Field>
      <Field
        label="CFG"
        hint={`${LIMITS.pictureCfgMin}–${LIMITS.pictureCfgMax}. Higher follows the prompt more literally, lower draws more freely.`}
      >
        <input
          className={inputStyle}
          type="number"
          min={LIMITS.pictureCfgMin}
          max={LIMITS.pictureCfgMax}
          step={0.5}
          value={settings.pictureCfg}
          onChange={(e) => set("pictureCfg", Number(e.target.value))}
        />
      </Field>
      <Field label="Sampler" hint="How the picture is worked out from noise. The DPM++ ones cost a little more Buzz.">
        <select
          className={inputStyle}
          value={settings.pictureSampler}
          onChange={(e) => set("pictureSampler", e.target.value as Sampler)}
        >
          {SAMPLERS.map((sampler) => (
            <option key={sampler.id} value={sampler.id}>
              {sampler.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Clip skip" hint="2 suits anime checkpoints such as WAI-illustrious.">
        <select
          className={inputStyle}
          value={settings.pictureClipSkip}
          onChange={(e) => set("pictureClipSkip", Number(e.target.value))}
        >
          {[1, 2, 3].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Seed"
        hint="The next picture starts from it, and whatever seed a picture is made with becomes this one, so pictures carry on alike."
      >
        <SeedInput
          value={settings.pictureSeed}
          onChange={(seed) => set("pictureSeed", seed)}
          placeholder="Chosen on the first picture"
        />
      </Field>
    </div>
  );
}
