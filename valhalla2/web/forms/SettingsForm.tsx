// What Valhalla 2 sends besides the profile.
//
// A Claude companion has no temperature here, and that is not an omission: the current Claude
// models reject `temperature`, `top_p` and `top_k` outright. Effort is the dial they left. A Grok
// companion has a temperature, and some settings work differently for it; the hints say how.
import { useState } from "react";
import {
  CACHE_TTLS,
  EFFORTS,
  hasFallback,
  LIMITS,
  MODELS,
  providerOf,
  type Provider,
  type Settings,
} from "../../shared/protocol.ts";
import { usePage } from "../page.ts";
import { Field, inputStyle } from "../ui/bits.tsx";

type Model = (typeof MODELS)[number];

/** A model from the picker, or any other id typed in by hand. */
function ModelField({
  label,
  hint,
  value,
  onChange,
  models,
  grok,
  note,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (model: string) => void;
  /** The models this field offers. */
  models: readonly Model[];
  /** Whether the server has an xAI key, so a Grok model can answer. */
  grok: boolean;
  /** A line under a model from the picker, given its cache-read price. */
  note?: (cacheRead: number) => string;
}) {
  const chosen = models.find((entry) => entry.id === value);
  const offersGrok = models.some((entry) => entry.provider === "xai");
  const offersClaude = models.some((entry) => entry.provider === "anthropic");
  return (
    <Field label={label} hint={hint}>
      <select
        className={inputStyle}
        value={chosen ? value : "other"}
        onChange={(e) => onChange(e.target.value === "other" ? "" : e.target.value)}
      >
        {models.map((entry) => (
          <option key={entry.id} value={entry.id} disabled={entry.provider === "xai" && !grok}>
            {entry.label} — ${entry.input} in / ${entry.output} out per Mtok
            {entry.provider === "xai" && !grok ? " (no xAI key on the server)" : ""}
          </option>
        ))}
        <option value="other">Another model, by name</option>
      </select>
      {chosen ? null : (
        <input
          className={`${inputStyle} mt-2 font-mono`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={offersGrok && offersClaude ? "claude-… or grok-…" : offersGrok ? "grok-…" : "claude-…"}
          aria-label={`${label} id`}
        />
      )}
      {chosen ? (
        note ? (
          <span className="mt-1 block text-xs text-faint">{note(chosen.cacheRead)}</span>
        ) : null
      ) : (
        <span className="mt-1 block text-xs text-faint">
          Any model id the API accepts. Valhalla 2 sends it as you typed it
          {offersGrok && offersClaude ? ": an id starting grok- goes to xAI, any other to Claude." : "."}
        </span>
      )}
    </Field>
  );
}

export function SettingsForm({
  settings,
  onChange,
  provider,
  memory,
  note,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
  /** The companion's API, once it is saved; null for a new one, which may pick either. */
  provider: Provider | null;
  /** Whether the companion has memory, so whether a memory model is asked for. */
  memory: boolean;
  note?: string;
}) {
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value });
  const [stops, setStops] = useState(settings.stopSequences.join("\n"));
  const { health } = usePage();
  const onGrok = providerOf(settings.model) === "xai";

  /**
   * A new chat model. Moving a new companion to Grok makes its memory model the Grok model too;
   * moving it back to Claude gives it the server's memory model again. A temperature is Grok's only.
   * Moving between Claude and Grok resets effort to what is economical there: Grok's high is slow
   * and dear for dialogue, so it starts low; Claude starts on the server's default (high, on Haiku).
   */
  const chooseModel = (model: string) => {
    const grok = providerOf(model) === "xai";
    const moved = grok !== onGrok;
    onChange({
      ...settings,
      model,
      memoryModel: moved ? (grok ? model : health.defaults.memoryModel) : settings.memoryModel,
      effort: moved ? (grok ? "low" : health.defaults.effort) : settings.effort,
      temperature: grok ? settings.temperature : null,
    });
  };

  return (
    <section className="space-y-4 rounded border border-rule bg-sheet/50 p-4">
      <div>
        <h2 className="font-display text-lg">Settings</h2>
        {note ? <p className="mt-1 text-xs text-faint">{note}</p> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ModelField
          label="Model"
          hint={
            provider === null
              ? "Answers in character. Claude or Grok is chosen now: a companion can't move between them later."
              : "Answers in character."
          }
          value={settings.model}
          onChange={chooseModel}
          models={provider === null ? MODELS : MODELS.filter((entry) => entry.provider === provider)}
          grok={health.grok}
          note={(cacheRead) => `Cache reads $${cacheRead} per Mtok — what the chat so far costs to re-send.`}
        />
        {memory ? (
          <ModelField
            label="Memory model"
            hint="Keeps the companion's memory up to date after a chat."
            value={settings.memoryModel}
            onChange={(model) => set("memoryModel", model)}
            models={MODELS.filter((entry) => entry.provider === (onGrok ? "xai" : "anthropic"))}
            grok={onGrok && health.grok}
          />
        ) : null}

        <Field
          label="Effort"
          hint={
            onGrok
              ? "How much thinking goes into a reply. Grok has no max: max is sent as xhigh."
              : "How much thinking goes into a reply, and so what it costs. Haiku does well on high; a dearer model often needs less."
          }
        >
          <select
            className={inputStyle}
            value={settings.effort}
            onChange={(e) => set("effort", e.target.value as Settings["effort"])}
          >
            {EFFORTS.map((effort) => (
              <option key={effort} value={effort}>
                {effort}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Longest reply" hint="In tokens. Replies stream, so a high ceiling costs nothing by itself.">
          <input
            className={inputStyle}
            type="number"
            min={LIMITS.minTokens}
            max={LIMITS.maxTokens}
            step={256}
            value={settings.maxTokens}
            onChange={(e) => set("maxTokens", Number(e.target.value))}
          />
        </Field>

        {onGrok ? (
          <Field
            label="Temperature"
            hint="How freely Grok picks its words: lower is steadier, higher more varied. Grok never goes above 1."
          >
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.temperature === null}
                onChange={(e) => set("temperature", e.target.checked ? null : 0.7)}
              />
              Grok's default
            </label>
            {settings.temperature === null ? null : (
              <span className="mt-2 flex items-center gap-3">
                <input
                  type="range"
                  className="flex-1"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.temperature}
                  onChange={(e) => set("temperature", Number(e.target.value))}
                  aria-label="Temperature"
                />
                <span className="w-10 text-right font-mono text-sm">{settings.temperature.toFixed(2)}</span>
              </span>
            )}
          </Field>
        ) : (
          <Field label="Keep the cache for" hint="How long the profile and the chat so far stay cheap to re-send.">
            <select
              className={inputStyle}
              value={settings.cacheTtl}
              onChange={(e) => set("cacheTtl", e.target.value as Settings["cacheTtl"])}
            >
              {CACHE_TTLS.map((ttl) => (
                <option key={ttl} value={ttl}>
                  {ttl === "5m" ? "5 minutes — cheapest if you reply quickly" : "1 hour — for longer pauses"}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      {onGrok ? (
        <p className="text-xs text-faint">
          Grok caches the chat by itself, for as long as it decides: there is no cache lifetime to choose.
        </p>
      ) : null}

      <Field
        label="Stop at"
        hint={
          onGrok
            ? "One per line. A reply ends the moment it writes any of these. Grok can't take them, so Valhalla 2 cuts the reply itself, and its cost is then not known."
            : "One per line. A reply ends the moment it writes any of these — useful to stop the model writing your lines."
        }
      >
        <textarea
          className={`${inputStyle} min-h-16 resize-y font-mono`}
          value={stops}
          onChange={(e) => {
            // What is typed stays as typed, blank lines and all; only what is sent is tidied.
            setStops(e.target.value);
            const lines = e.target.value.split("\n").filter((line) => line.trim() !== "");
            set("stopSequences", lines.slice(0, LIMITS.stopSequences));
          }}
          placeholder="Eadric:"
        />
      </Field>

      {onGrok ? null : (
        <label className={`flex items-start gap-2 text-sm ${hasFallback(settings.model) ? "" : "opacity-60"}`}>
          <input
            type="checkbox"
            className="mt-1"
            checked={settings.fallbacks}
            disabled={!hasFallback(settings.model)}
            onChange={(e) => set("fallbacks", e.target.checked)}
          />
          <span>
            Let another model answer if this one declines
            <span className="mt-0.5 block text-xs text-faint">
              {hasFallback(settings.model)
                ? "Valhalla 2 adds no filter of its own either way. This only decides whether a turn the API declines gets a second chance on another model before it comes back to you."
                : "The API has no other model to hand a declined Haiku turn to, so this does nothing here."}
            </span>
          </span>
        </label>
      )}
    </section>
  );
}
