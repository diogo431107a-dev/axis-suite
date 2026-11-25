// The voice a companion's replies are read aloud in: any of the voices Azure offers, found by
// name or language, and heard before it is chosen; and whether replies are read with the feeling
// of each line, as the scene works it out.
import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, Volume2 } from "lucide-react";
import { FEELINGS, LIMITS, type Feeling, type Voice, type VoiceList } from "../../shared/protocol.ts";
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

export function VoicePicker({
  value,
  onChange,
  feeling,
  onFeeling,
}: {
  value: string | null;
  onChange: (voice: string | null) => void;
  /** Whether replies are read with the feeling of each line. */
  feeling: boolean;
  onFeeling: (feeling: boolean) => void;
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
      const audio = await apiBlob("/api/voices/sample", { voice: value, text: sample, feeling: sampleFeeling });
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
          The voice its replies are read aloud in, from every voice Azure offers. A reply already read is read again in
          the new voice the next time you play it.
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
              onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
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
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={feeling} onChange={(e) => onFeeling(e.target.checked)} />
            <span>
              Read with feeling
              <span className="mt-0.5 block text-xs text-faint">
                Before a reply is read, Claude works out the scene (the clapperboard under it) and how each line is
                said: teasing, whispered, angry. A fraction of a cent a reply, and a moment's wait the first time.{" "}
                {chosen && chosen.styles.length > 0
                  ? `${chosen.name} has styles of its own (${chosen.styles.join(", ")}), which sound the most natural; other feelings are read with speed, pitch and volume.`
                  : "This voice has no styles of its own, so feelings are read with speed, pitch and volume. Type “styles” above to find voices that have them."}
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
