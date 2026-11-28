// How CivitAI makes this companion's pictures: steps, CFG, sampler, clip skip, and the seed the next
// picture starts from. Shown when the server can make pictures.
import { Dices } from "lucide-react";
import { LIMITS, SAMPLERS, type Sampler, type Settings } from "../../shared/protocol.ts";
import { Field, inputStyle } from "../ui/bits.tsx";
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

export function PictureSettings({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
}) {
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
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
