import { useState } from "react";
import { DEFAULT_SETTINGS, LIMITS, type Character, type Settings } from "../../shared/protocol.ts";
import { api } from "../api.ts";
import { usePage } from "../page.ts";
import { SettingsForm } from "./SettingsForm.tsx";
import { Button, Field, inputStyle, Notice } from "../ui/bits.tsx";
import { useSave } from "../ui/useSave.ts";

/**
 * A new character starts with this in Behavior. It is a suggestion in a field you own, not
 * something Valhalla adds behind your back: change it, or clear it, and that is what gets sent.
 * Without a line like it the model is as likely to describe the character as to be one.
 */
const SUGGESTED_BEHAVIOR = "Stay in character. Write only their words and actions — never mine, and never a summary.";

const area = `${inputStyle} min-h-32 resize-y font-body leading-relaxed`;

export function CharacterForm({ character }: { character: Character | null }) {
  const { reload, open } = usePage();
  const { error, saving, run } = useSave();
  const [name, setName] = useState(character?.name ?? "");
  const [personality, setPersonality] = useState(character?.personality ?? "");
  const [appearance, setAppearance] = useState(character?.appearance ?? "");
  const [behavior, setBehavior] = useState(character?.behavior ?? SUGGESTED_BEHAVIOR);
  const [settings, setSettings] = useState<Settings>(character?.settings ?? { ...DEFAULT_SETTINGS });

  const save = () =>
    run(async () => {
      const id = character?.id ?? crypto.randomUUID();
      await api(`/api/characters/${id}`, {
        method: "PUT",
        body: { name, personality, appearance, behavior, settings },
      });
      await reload();
      open({ kind: "character", id });
    });

  const remove = () =>
    run(async () => {
      if (!character) return;
      await api(`/api/characters/${character.id}`, { method: "DELETE" });
      await reload();
      open({ kind: "none" });
    });

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-5">
      <h1 className="font-display text-2xl">{character ? character.name : "A new character"}</h1>
      <p className="text-sm text-faint">
        Every word here is sent exactly as you write it. Valhalla contributes the headings and nothing else.
      </p>

      <Field label="Name">
        <input
          className={inputStyle}
          value={name}
          maxLength={LIMITS.name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Hrothgar"
        />
      </Field>

      <Field label="Personality" hint="Who they are, under everything.">
        <textarea
          className={area}
          value={personality}
          maxLength={LIMITS.field}
          onChange={(e) => setPersonality(e.target.value)}
          placeholder="Proud, and tired of being proud. Speaks in short sentences when angry."
        />
      </Field>

      <Field label="Appearance" hint="What you would see.">
        <textarea
          className={area}
          value={appearance}
          maxLength={LIMITS.field}
          onChange={(e) => setAppearance(e.target.value)}
          placeholder="Grey-bearded, in a mail shirt he no longer needs."
        />
      </Field>

      <Field label="Behavior" hint="How they act, and how they write. This is where you say to stay in character.">
        <textarea
          className={area}
          value={behavior}
          maxLength={LIMITS.field}
          onChange={(e) => setBehavior(e.target.value)}
        />
      </Field>

      <SettingsForm
        settings={settings}
        onChange={setSettings}
        note="The settings a new conversation with them starts from. Each conversation can change its own afterwards."
      />

      <Notice>{error}</Notice>

      <div className="flex items-center gap-2">
        <Button kind="strong" onClick={save} disabled={saving || !name.trim()}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button kind="quiet" onClick={() => open({ kind: "none" })}>
          Cancel
        </Button>
        {character ? (
          <span className="ml-auto">
            <Button kind="danger" onClick={remove} disabled={saving}>
              Delete
            </Button>
          </span>
        ) : null}
      </div>
    </div>
  );
}
