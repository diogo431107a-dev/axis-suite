// What Valhalla sends besides the character and the persona.
//
// There is no temperature here, and that is not an omission: the current models reject
// `temperature`, `top_p` and `top_k` outright. Effort is the dial they left.
import { useState } from "react";
import { CACHE_TTLS, EFFORTS, LIMITS, MODELS, type Settings } from "../../shared/protocol.ts";
import { Field, inputStyle } from "../ui/bits.tsx";

const known = (model: string) => MODELS.some((entry) => entry.id === model);

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
  const chosen = MODELS.find((entry) => entry.id === settings.model);
  const [stops, setStops] = useState(settings.stopSequences.join("\n"));

  return (
    <section className="space-y-4 rounded border border-rule bg-sheet/50 p-4">
      <div>
        <h2 className="font-display text-lg">Settings</h2>
        {note ? <p className="mt-1 text-xs text-faint">{note}</p> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Model">
          <select
            className={inputStyle}
            value={known(settings.model) ? settings.model : "other"}
            onChange={(e) => set("model", e.target.value === "other" ? "" : e.target.value)}
          >
            {MODELS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label} — ${entry.input} in / ${entry.output} out per Mtok
              </option>
            ))}
            <option value="other">Another model, by name</option>
          </select>
          {known(settings.model) ? null : (
            <input
              className={`${inputStyle} mt-2 font-mono`}
              value={settings.model}
              onChange={(e) => set("model", e.target.value)}
              placeholder="claude-…"
              aria-label="Model id"
            />
          )}
          {chosen ? (
            <span className="mt-1 block text-xs text-faint">
              Cache reads ${chosen.cacheRead} per Mtok — what the conversation so far costs to re-send.
            </span>
          ) : (
            <span className="mt-1 block text-xs text-faint">
              Any model id the API accepts. Valhalla sends it as you typed it.
            </span>
          )}
        </Field>

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

        <Field label="Keep the cache for" hint="How long the character, persona and history stay cheap to re-send.">
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

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={settings.fallbacks}
          onChange={(e) => set("fallbacks", e.target.checked)}
        />
        <span>
          Let another model answer if this one declines
          <span className="mt-0.5 block text-xs text-faint">
            Valhalla adds no filter of its own either way. This only decides whether a turn the API declines gets a
            second chance on another model before it comes back to you.
          </span>
        </span>
      </label>
    </section>
  );
}
