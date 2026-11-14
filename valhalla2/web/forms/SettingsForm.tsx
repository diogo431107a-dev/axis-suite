// What Valhalla 2 sends besides the profile.
//
// There is no temperature here, and that is not an omission: the current models reject
// `temperature`, `top_p` and `top_k` outright. Effort is the dial they left.
import { useState } from "react";
import { CACHE_TTLS, EFFORTS, hasFallback, LIMITS, MODELS, type Settings } from "../../shared/protocol.ts";
import { Field, inputStyle } from "../ui/bits.tsx";

const known = (model: string) => MODELS.some((entry) => entry.id === model);

/** A model from the picker, or any other id typed in by hand. */
function ModelField({
  label,
  hint,
  value,
  onChange,
  note,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (model: string) => void;
  /** A line under a model from the picker, given its cache-read price. */
  note?: (cacheRead: number) => string;
}) {
  const chosen = MODELS.find((entry) => entry.id === value);
  return (
    <Field label={label} hint={hint}>
      <select
        className={inputStyle}
        value={known(value) ? value : "other"}
        onChange={(e) => onChange(e.target.value === "other" ? "" : e.target.value)}
      >
        {MODELS.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label} — ${entry.input} in / ${entry.output} out per Mtok
          </option>
        ))}
        <option value="other">Another model, by name</option>
      </select>
      {known(value) ? null : (
        <input
          className={`${inputStyle} mt-2 font-mono`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="claude-…"
          aria-label={`${label} id`}
        />
      )}
      {chosen ? (
        note ? (
          <span className="mt-1 block text-xs text-faint">{note(chosen.cacheRead)}</span>
        ) : null
      ) : (
        <span className="mt-1 block text-xs text-faint">
          Any model id the API accepts. Valhalla 2 sends it as you typed it.
        </span>
      )}
    </Field>
  );
}

export function SettingsForm({
  settings,
  onChange,
  note,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
  note?: string;
}) {
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value });
  const [stops, setStops] = useState(settings.stopSequences.join("\n"));

  return (
    <section className="space-y-4 rounded border border-rule bg-sheet/50 p-4">
      <div>
        <h2 className="font-display text-lg">Settings</h2>
        {note ? <p className="mt-1 text-xs text-faint">{note}</p> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ModelField
          label="Model"
          hint="Answers in character."
          value={settings.model}
          onChange={(model) => set("model", model)}
          note={(cacheRead) => `Cache reads $${cacheRead} per Mtok — what the chat so far costs to re-send.`}
        />
        <ModelField
          label="Memory model"
          hint="Keeps the companion's memory up to date after a chat."
          value={settings.memoryModel}
          onChange={(model) => set("memoryModel", model)}
        />

        <Field label="Effort" hint="How much thinking goes into a reply. Dialogue usually wants low.">
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
      </div>

      <Field
        label="Stop at"
        hint="One per line. A reply ends the moment it writes any of these — useful to stop the model writing your lines."
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
    </section>
  );
}
