// A companion's page: its name on top, then folding sections in the order they are usually needed,
// with the Save row always at the bottom of the window.
import { useState } from "react";
import { Brain, Images } from "lucide-react";
import {
  DEFAULT_TUNING,
  LIMITS,
  MODELS,
  PROMPT_KEYS,
  providerOf,
  samplerLabel,
  type Companion,
  type PromptKey,
  type Prompts,
  type Settings,
  type VoiceTuning,
} from "../../shared/protocol.ts";
import { DEFAULT_PROMPTS, PROMPT_LABELS } from "../../shared/prompts.ts";
import { api } from "../api.ts";
import { usePage } from "../page.ts";
import { SettingsForm, ToneSettings } from "./SettingsForm.tsx";
import { PictureSettings } from "./PictureSettings.tsx";
import { VoicePicker } from "./VoicePicker.tsx";
import { useAutosize } from "../ui/autosize.ts";
import { Button, Field, Fold, inputStyle, Notice } from "../ui/bits.tsx";
import { useSave } from "../ui/useSave.ts";

/**
 * A new companion starts with this in its profile. It is a suggestion in a field you own, not
 * something Valhalla 2 adds behind your back: change it, or clear it, and that is what gets sent.
 */
const SUGGESTED_PROFILE = `<personality>
Who she is, under everything.
</personality>

<appearance>
What you would see.
</appearance>

<behavior>
Stay in character. Write only her words and actions — never mine, and never a summary.
</behavior>

<user_persona>
Who you are when you talk to her.
</user_persona>`;

const area = `${inputStyle} resize-y font-body leading-relaxed`;

/** Every prompt text as the form shows it: the companion's own words, or the default, to edit. */
const promptTexts = (own: Prompts): Record<PromptKey, string> =>
  Object.fromEntries(PROMPT_KEYS.map((key) => [key, own[key] ?? DEFAULT_PROMPTS[key]])) as Record<PromptKey, string>;

const isDefault = (key: PromptKey, text: string): boolean => text.trim() === DEFAULT_PROMPTS[key].trim();

/** The texts only a companion with memory uses: the others go out without memory too. */
const MEMORY_ONLY: readonly PromptKey[] = ["memoryPolicy", "quiet", "consolidation", "cleanup", "scene"];

/**
 * What is saved: only the texts you changed. One left as the default (or emptied) isn't stored, so
 * the companion keeps following the default, including when a later version improves it.
 */
const ownPrompts = (texts: Record<PromptKey, string>): Prompts =>
  Object.fromEntries(
    PROMPT_KEYS.filter((key) => texts[key].trim() !== "" && !isDefault(key, texts[key])).map((key) => [
      key,
      texts[key],
    ]),
  );

/** A model's name from the picker, or its id when it was typed in by hand. */
const modelLabel = (id: string): string => MODELS.find((entry) => entry.id === id)?.label ?? id;

/** An Azure voice's own name from its id: en-US-AvaMultilingualNeural reads Ava. */
const voiceLabel = (id: string): string =>
  id
    .split("-")
    .slice(2)
    .join("-")
    .replace(/(Multilingual)?Neural$/, "") || id;

/** The profile's box: as tall as its text, and never less than most of the window. */
function ProfileBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const ref = useAutosize(value);
  return (
    <textarea
      ref={ref}
      aria-label="Profile"
      className={`${area} min-h-[70vh] font-mono text-xs`}
      value={value}
      maxLength={LIMITS.profile}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** One of Valhalla 2's own texts, in a fold of its own: closed until you open it to read or change. */
function OwnWords({
  promptKey,
  value,
  onChange,
}: {
  promptKey: PromptKey;
  value: string;
  onChange: (value: string) => void;
}) {
  const ref = useAutosize(value);
  const own = !isDefault(promptKey, value);
  const { label, hint } = PROMPT_LABELS[promptKey];
  return (
    <details className="rounded border border-rule bg-paper/60">
      <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 px-3 py-2 select-none">
        <span className="text-sm font-medium">{label}</span>
        {own ? <span className="text-xs text-accent">your own words</span> : null}
        <span className="basis-full text-xs text-faint">{hint}</span>
      </summary>
      <div className="px-3 pb-3">
        <textarea
          ref={ref}
          aria-label={label}
          className={`${area} min-h-[40vh]`}
          value={value}
          maxLength={LIMITS.prompt}
          onChange={(e) => onChange(e.target.value)}
        />
        {own ? (
          <span className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-faint">
            {value.trim() === "" ? <span>Empty, so the default is used.</span> : <span>Your own words.</span>}
            <button type="button" className="hover:text-accent" onClick={() => onChange(DEFAULT_PROMPTS[promptKey])}>
              Back to the default
            </button>
          </span>
        ) : null}
      </div>
    </details>
  );
}

export function CompanionForm({ companion }: { companion: Companion | null }) {
  const { health, chats, reload, open } = usePage();
  const { error, saving, run } = useSave();
  const [name, setName] = useState(companion?.name ?? "");
  const [profile, setProfile] = useState(companion?.profile ?? SUGGESTED_PROFILE);
  const [settings, setSettings] = useState<Settings>(companion?.settings ?? { ...health.defaults });
  const [prompts, setPrompts] = useState(() => promptTexts(companion?.prompts ?? {}));
  const [voice, setVoice] = useState<string | null>(companion?.voice ?? null);
  const [voiceFeeling, setVoiceFeeling] = useState(companion?.voiceFeeling ?? true);
  const [voiceTuning, setVoiceTuning] = useState<VoiceTuning>(companion?.voiceTuning ?? DEFAULT_TUNING);
  const [confirming, setConfirming] = useState(false);
  // Chosen when the companion is created. A Grok companion without memory can have it turned on later.
  const [withMemory, setWithMemory] = useState(companion?.memory ?? true);
  const provider = companion?.provider ?? providerOf(settings.model);
  const memory = companion?.memory ?? withMemory;

  const chatCount = companion ? chats.filter((chat) => chat.companionId === companion.id).length : 0;
  const shownPrompts = PROMPT_KEYS.filter((key) => memory || !MEMORY_ONLY.includes(key));
  const ownCount = shownPrompts.filter((key) => !isDefault(key, prompts[key])).length;
  const profileLines = profile.split("\n").length;

  const save = () =>
    run(async () => {
      const id = companion?.id ?? crypto.randomUUID();
      await api(`/api/companions/${id}`, {
        method: "PUT",
        body: { name, profile, settings, prompts: ownPrompts(prompts), voice, voiceFeeling, voiceTuning, memory },
      });
      await reload();
      open({ kind: "companion", id });
    });

  const remove = () =>
    run(async () => {
      if (!companion) return;
      await api(`/api/companions/${companion.id}`, { method: "DELETE" });
      await reload();
      open({ kind: "none" });
    });

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-5 pt-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl">{companion ? companion.name : "A new companion"}</h1>
        {companion ? (
          <span className="ml-auto flex gap-2">
            <Button kind="plain" onClick={() => open({ kind: "gallery", companionId: companion.id })}>
              <Images size={15} /> Pictures
            </Button>
            <Button kind="plain" onClick={() => open({ kind: "memory", companionId: companion.id })}>
              <Brain size={15} /> {companion.memory ? "Memory" : "Pins"}
            </Button>
          </span>
        ) : null}
      </div>

      {companion ? (
        <p className="-mt-2 text-sm text-faint">
          {companion.provider === "xai" ? "Grok" : "Claude"} · {companion.memory ? "with memory" : "without memory"}.
          Both were chosen when it was created
          {companion.provider === "xai" && !companion.memory ? "; memory can be turned on from its Pins page." : "."}
        </p>
      ) : null}

      <Field label="Name" hint="For the list. The model reads the profile, not this.">
        <input
          className={inputStyle}
          value={name}
          maxLength={LIMITS.name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Wealhtheow"
        />
      </Field>

      <Fold
        title="Profile"
        open
        hint={`${profileLines} ${profileLines === 1 ? "line" : "lines"} · ${profile.length.toLocaleString()} characters`}
      >
        <p className="text-xs text-faint">
          Everything the model reads about who it is, and who you are when you talk to it. Sent exactly as you write it,
          tags and all.
        </p>
        <ProfileBox value={profile} onChange={setProfile} />
      </Fold>

      <Fold
        title="Model and memory"
        open={!companion}
        hint={`${modelLabel(settings.model)} · ${settings.effort}${
          memory ? ` · memory on ${modelLabel(settings.memoryModel)}` : " · without memory"
        }`}
      >
        {companion ? null : (
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-medium">Memory</h3>
              <p className="mt-0.5 text-xs text-faint">
                Chosen now, with the model below: a companion can't change it, or move between Claude and Grok, later.
              </p>
            </div>
            <div className="space-y-2 text-sm">
              <label className="flex items-start gap-2">
                <input type="radio" className="mt-1" checked={withMemory} onChange={() => setWithMemory(true)} />
                <span>
                  With memory
                  <span className="mt-0.5 block text-xs text-faint">
                    The memory model keeps what happens across chats; the oldest turns of a long chat slide out into it.
                    {" Topics to leave alone, and pictures drawn from the scene, which keeps track of the story."}
                    {provider === "xai" ? " Nothing it says goes to Claude." : ""}
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" className="mt-1" checked={!withMemory} onChange={() => setWithMemory(false)} />
                <span>
                  Without memory
                  <span className="mt-0.5 block text-xs text-faint">
                    Every chat is sent whole each turn, with your pins. Pictures are drawn from the message you choose.
                    {provider === "xai" ? " Memory can be turned on later." : ""}
                  </span>
                </span>
              </label>
            </div>
          </section>
        )}
        <SettingsForm
          settings={settings}
          onChange={setSettings}
          provider={companion?.provider ?? null}
          memory={memory}
          note="Every chat with this companion uses these."
        />
      </Fold>

      {health.pictures ? (
        <Fold
          title="Pictures"
          hint={`${samplerLabel(settings.pictureSampler)} · ${settings.pictureSteps} steps · CFG ${settings.pictureCfg}${
            settings.pictureSeed === null ? "" : ` · seed ${settings.pictureSeed}`
          }`}
        >
          <PictureSettings settings={settings} onChange={setSettings} />
        </Fold>
      ) : null}

      {health.speech ? (
        <Fold
          title="Voice"
          hint={`${voice ? voiceLabel(voice) : "the server's voice"} · ${voiceFeeling ? "with feeling" : "plainly"}`}
        >
          <VoicePicker
            value={voice}
            onChange={setVoice}
            tuning={voiceTuning}
            onTuning={setVoiceTuning}
            feeling={voiceFeeling}
            onFeeling={setVoiceFeeling}
          >
            <ToneSettings settings={settings} onChange={setSettings} />
          </VoicePicker>
        </Fold>
      ) : null}

      <Fold
        title="Valhalla 2's own words"
        hint={ownCount === 0 ? "all the defaults" : `${ownCount} ${ownCount === 1 ? "text" : "texts"} your own`}
      >
        <p className="text-xs text-faint">
          The only text Valhalla 2 adds besides your profile and the chat. Each starts as the default: open one to read
          or change it. One left as the default keeps following it when a later version of Valhalla 2 improves it.
          Inspect, in a chat, shows each one where it goes out.
        </p>
        <div className="space-y-2">
          {shownPrompts.map((key) => (
            <OwnWords
              key={key}
              promptKey={key}
              value={prompts[key]}
              onChange={(value) => setPrompts({ ...prompts, [key]: value })}
            />
          ))}
        </div>
      </Fold>

      <div className="sticky bottom-0 z-10 -mx-5 space-y-2 border-t border-rule bg-paper px-5 py-3">
        <Notice>{error}</Notice>
        <div className="flex flex-wrap items-center gap-2">
          <Button kind="strong" onClick={save} disabled={saving || !name.trim()}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button kind="quiet" onClick={() => open({ kind: "none" })}>
            Cancel
          </Button>
          {companion ? (
            <span className="ml-auto flex items-center gap-2">
              {confirming ? (
                <>
                  <span className="text-sm text-warn">
                    {chatCount === 0
                      ? "Delete this companion?"
                      : `Delete this companion and its ${chatCount === 1 ? "chat" : `${chatCount} chats`}?`}
                  </span>
                  <Button kind="danger" onClick={remove} disabled={saving}>
                    Delete
                  </Button>
                  <Button kind="quiet" onClick={() => setConfirming(false)}>
                    Keep
                  </Button>
                </>
              ) : (
                <Button kind="danger" onClick={() => setConfirming(true)} disabled={saving}>
                  Delete…
                </Button>
              )}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
