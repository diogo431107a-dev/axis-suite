// The voice a companion's replies are read aloud in: any of the voices Azure offers, found by
// name or language, and heard before it is chosen; its speed, pitch and speaking style; and
// whether replies are read with the feeling of each line, as the scene works it out.
import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, RotateCcw, Volume2 } from "lucide-react";
import { FEELINGS, LIMITS, type Feeling, type Voice, type VoiceList, type VoiceTuning } from "../../shared/protocol.ts";
import { api, apiBlob, describeError } from "../api.ts";
import { Button, Field, inputStyle, Notice } from "../ui/bits.tsx";

/** What a voice reads when you try it, until you change it. */
const SAMPLE = "Hello. This is how I sound when your replies are read aloud.";

const describe = (voice: Voice): string =>
  [
    voice.name,
    voice.gender,
    voice.multilingual ? "multilingual" : "",
    voice.styles.length > 0 ? `${voice.styles.length} styles` : "",
  ]
    .filter(Boolean)
    .join(" · ");

const matches = (voice: Voice, words: string[]): boolean => {
  const about =
    `${voice.id} ${voice.name} ${voice.language} ${voice.gender} ${voice.multilingual ? "multilingual" : ""} ${
      voice.styles.length > 0 ? `styles ${voice.styles.join(" ")}` : ""
    }`.toLowerCase();
  return words.every((word) => about.includes(word));
};

/** A change in percent as the page shows it: "usual", "+15%", "−10%". */
const change = (value: number): string => (value === 0 ? "usual" : `${value > 0 ? "+" : "−"}${Math.abs(value)}%`);

/** Faster or slower, higher or lower: a slider from Azure's least to its most, and back to usual. */
function Tuner({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <span className="flex items-center gap-3">
        <input
          type="range"
          className="flex-1"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={label}
        />
        <span className="w-12 text-right font-mono text-sm">{change(value)}</span>
        <Button
          kind="quiet"
          onClick={() => onChange(0)}
          disabled={value === 0}
          title={`Back to the voice's usual ${label.toLowerCase()}`}
        >
          <RotateCcw size={14} />
        </Button>
      </span>
    </Field>
  );
}

export function VoicePicker({
  value,
  onChange,
  tuning,
  onTuning,
  feeling,
  onFeeling,
  withFeeling = true,
}: {
  value: string | null;
  onChange: (voice: string | null) => void;
  /** The voice's speed, pitch and speaking style. */
  tuning: VoiceTuning;
  onTuning: (tuning: VoiceTuning) => void;
  /** Whether replies are read with the feeling of each line. */
  feeling: boolean;
  onFeeling: (feeling: boolean) => void;
  /** Whether feeling is offered at all: a companion without memory has no scene, so reads plainly. */
  withFeeling?: boolean;
}) {
  const [list, setList] = useState<VoiceList | null>(null);
  const [error, setError] = useState("");
  const [find, setFind] = useState("");
  const [sample, setSample] = useState(SAMPLE);
  const [hearing, setHearing] = useState(false);
  /** The feeling the sample is read with; null reads it plainly. */
  const [sampleFeeling, setSampleFeeling] = useState<Feeling | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    api<VoiceList>("/api/voices")
      .then(setList)
      .catch((err: unknown) => setError(describeError(err)));
    return () => player.current?.pause();
  }, []);

  const voices = useMemo(() => list?.voices ?? [], [list]);
  const byId = (id: string) => voices.find((voice) => voice.id === id);
  const serverVoice = list ? byId(list.default) : undefined;
  const chosen = value ? byId(value) : serverVoice;
  const styles = chosen?.styles ?? [];

  /** Another voice; a speaking style it hasn't is let go. */
  const choose = (next: string | null) => {
    onChange(next);
    const nextStyles = (next ? byId(next) : serverVoice)?.styles ?? [];
    if (tuning.style && !nextStyles.includes(tuning.style)) onTuning({ ...tuning, style: null });
  };

  // The voices that match what you typed, by language; the chosen one is always there.
  const groups = useMemo(() => {
    const words = find.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = voices.filter((voice) => voice.id === value || matches(voice, words));
    const grouped = new Map<string, Voice[]>();
    for (const voice of shown) grouped.set(voice.language, [...(grouped.get(voice.language) ?? []), voice]);
    return [...grouped];
  }, [voices, find, value]);
  const shownCount = groups.reduce((n, [, group]) => n + group.length, 0);

  const hear = async () => {
    setHearing(true);
    setError("");
    try {
      const audio = await apiBlob("/api/voices/sample", {
        voice: value,
        text: sample,
        feeling: sampleFeeling,
        tuning,
      });
      const url = URL.createObjectURL(audio);
      player.current?.pause();
      const playing = new Audio(url);
      player.current = playing;
      playing.addEventListener("ended", () => URL.revokeObjectURL(url));
      await playing.play();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setHearing(false);
    }
  };

  return (
    <section className="space-y-4 rounded border border-rule bg-sheet/50 p-4">
      <div>
        <h2 className="font-display text-lg">Voice</h2>
        <p className="mt-1 text-xs text-faint">
          The voice its replies are read aloud in, from every voice Azure offers, and how it speaks. A reply already
          read is read again in the new voice, speed, pitch or style the next time you play it.
        </p>
      </div>

      {list ? (
        <>
          <Field label="Find a voice" hint={`${shownCount} of ${voices.length} voices. By name, language or gender.`}>
            <input
              className={inputStyle}
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="portuguese female, Francisca, multilingual…"
            />
          </Field>
          <Field label="Read aloud in">
            <select
              className={inputStyle}
              value={value ?? ""}
              onChange={(e) => choose(e.target.value === "" ? null : e.target.value)}
            >
              <option value="">
                The server's voice
                {serverVoice ? ` — ${serverVoice.name}, ${serverVoice.language}` : ` — ${list.default}`}
              </option>
              {value && !byId(value) ? <option value={value}>{value} (not in Azure's list)</option> : null}
              {groups.map(([language, group]) => (
                <optgroup key={language} label={language}>
                  {group.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {describe(voice)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Tuner
              label="Speed"
              hint="From half to twice the voice's usual speed."
              value={tuning.rate}
              min={LIMITS.voiceRateMin}
              max={LIMITS.voiceRateMax}
              step={5}
              onChange={(rate) => onTuning({ ...tuning, rate })}
            />
            <Tuner
              label="Pitch"
              hint="Lower or higher than the voice's usual, by up to half."
              value={tuning.pitch}
              min={LIMITS.voicePitchMin}
              max={LIMITS.voicePitchMax}
              step={1}
              onChange={(pitch) => onTuning({ ...tuning, pitch })}
            />
          </div>
          {styles.length > 0 ? (
            <Field
              label="Speaking style"
              hint={`${chosen?.name ?? "This voice"} has styles of its own. Lines are read in this one unless their feeling has a style that fits better.`}
            >
              <select
                className={inputStyle}
                value={tuning.style ?? ""}
                onChange={(e) => onTuning({ ...tuning, style: e.target.value === "" ? null : e.target.value })}
              >
                <option value="">None — the voice's usual way</option>
                {tuning.style && !styles.includes(tuning.style) ? (
                  <option value={tuning.style}>{tuning.style} (this voice hasn't it)</option>
                ) : null}
                {styles.map((style) => (
                  <option key={style} value={style}>
                    {style}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {withFeeling ? null : (
            <p className="text-xs text-faint">
              Without memory there is no scene to read a reply's feeling from, so replies are read plainly, as written.
            </p>
          )}
          <label className={withFeeling ? "flex items-start gap-2 text-sm" : "hidden"}>
            <input type="checkbox" className="mt-1" checked={feeling} onChange={(e) => onFeeling(e.target.checked)} />
            <span>
              Read with feeling
              <span className="mt-0.5 block text-xs text-faint">
                Before a reply is read, Claude works out the scene (the clapperboard under it) and how each line is
                said: teasing, whispered, angry. A fraction of a cent a reply, and a moment's wait the first time.{" "}
                {chosen && chosen.styles.length > 0
                  ? `${chosen.name} has styles of its own (${chosen.styles.join(", ")}), which sound the most natural; other feelings are read with speed, pitch and volume, on top of the speed and pitch above.`
                  : "This voice has no styles of its own, so feelings are read with speed, pitch and volume, on top of the speed and pitch above. Type “styles” above to find voices that have them."}
              </span>
            </span>
          </label>
          <Field
            label="Try it"
            hint="Read by Azure like a reply, so it counts toward this month's characters; hearing the same words again is free."
          >
            <div className="flex items-start gap-2">
              <textarea
                className={`${inputStyle} min-h-11 resize-y leading-relaxed`}
                value={sample}
                maxLength={LIMITS.voiceSample}
                onChange={(e) => setSample(e.target.value)}
              />
              <select
                aria-label="Read it"
                hidden={!withFeeling}
                className={`${inputStyle} w-auto`}
                value={sampleFeeling ?? ""}
                onChange={(e) => setSampleFeeling(e.target.value === "" ? null : (e.target.value as Feeling))}
              >
                <option value="">plainly</option>
                {FEELINGS.filter((one) => one !== "neutral").map((one) => (
                  <option key={one} value={one}>
                    {one}
                  </option>
                ))}
              </select>
              <Button kind="plain" onClick={() => void hear()} disabled={hearing || !sample.trim()}>
                {hearing ? <LoaderCircle size={15} className="animate-spin" /> : <Volume2 size={15} />} Hear it
              </Button>
            </div>
          </Field>
        </>
      ) : error ? null : (
        <p className="text-sm text-faint">Asking Azure for its voices…</p>
      )}
      <Notice>{error}</Notice>
    </section>
  );
}
