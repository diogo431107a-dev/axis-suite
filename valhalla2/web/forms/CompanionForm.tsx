import { useState } from "react";
import { Brain, Images } from "lucide-react";
import {
  DEFAULT_TUNING,
  LIMITS,
  PROMPT_KEYS,
  providerOf,
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
import { VoicePicker } from "./VoicePicker.tsx";
import { Button, Field, inputStyle, Notice } from "../ui/bits.tsx";
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
    <div className="mx-auto max-w-3xl space-y-5 p-5">
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
        <p className="-mt-3 text-sm text-faint">
          {companion.provider === "xai" ? "Grok" : "Claude"} · {companion.memory ? "with memory" : "without memory"}.
          Both were chosen when it was created
          {companion.provider === "xai" && !companion.memory ? "; memory can be turned on from its Pins page." : "."}
        </p>
      ) : (
        <section className="space-y-3 rounded border border-rule bg-sheet/50 p-4">
          <div>
            <h2 className="font-display text-lg">Memory</h2>
            <p className="mt-1 text-xs text-faint">
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

      <Field label="Name" hint="For the list. The model reads the profile, not this.">
        <input
          className={inputStyle}
          value={name}
          maxLength={LIMITS.name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Wealhtheow"
        />
      </Field>

      <Field
        label="Profile"
        hint="Everything the model reads about who it is, and who you are when you talk to it. Sent exactly as you write it, tags and all."
      >
        <textarea
          className={`${area} min-h-96 font-mono text-xs`}
          value={profile}
          maxLength={LIMITS.profile}
          onChange={(e) => setProfile(e.target.value)}
        />
      </Field>

      <SettingsForm
        settings={settings}
        onChange={setSettings}
        provider={companion?.provider ?? null}
        memory={memory}
        note="Every chat with this companion uses these."
      />

      {health.speech ? (
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
      ) : null}

      <section className="space-y-4 rounded border border-rule bg-sheet/50 p-4">
        <div>
          <h2 className="font-display text-lg">Valhalla 2's own words</h2>
          <p className="mt-1 text-xs text-faint">
            The only text Valhalla 2 adds besides your profile and the chat. Each box starts with the default: change it
            as you like. One left as the default keeps following it when a later version of Valhalla 2 improves it.
            Inspect, in a chat, shows each one where it goes out.
          </p>
        </div>
        {PROMPT_KEYS.filter((key) => memory || !MEMORY_ONLY.includes(key)).map((key) => (
          <Field key={key} label={PROMPT_LABELS[key].label} hint={PROMPT_LABELS[key].hint}>
            <textarea
              className={`${area} min-h-24`}
              value={prompts[key]}
              maxLength={LIMITS.prompt}
              onChange={(e) => setPrompts({ ...prompts, [key]: e.target.value })}
            />
            {isDefault(key, prompts[key]) ? null : (
              <span className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-faint">
                {prompts[key].trim() === "" ? (
                  <span>Empty, so the default is used.</span>
                ) : (
                  <span>Your own words.</span>
                )}
                <button
                  type="button"
                  className="hover:text-accent"
                  onClick={() => setPrompts({ ...prompts, [key]: DEFAULT_PROMPTS[key] })}
                >
                  Back to the default
                </button>
              </span>
            )}
          </Field>
        ))}
      </section>

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
  );
}
