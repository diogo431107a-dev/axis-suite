// What you see with nothing open: how to begin, and the one form that starts a conversation.
import { useState } from "react";
import { usePage } from "../page.ts";
import { api } from "../api.ts";
import { Button, Field, inputStyle, Notice } from "../ui/bits.tsx";
import { useSave } from "../ui/useSave.ts";

export function Start() {
  const { characters, personas, health, reload, open } = usePage();
  const { error, saving, run } = useSave();
  const [characterId, setCharacterId] = useState(characters[0]?.id ?? "");
  const [personaId, setPersonaId] = useState(personas[0]?.id ?? "");

  const ready = characters.length > 0 && personas.length > 0;

  const start = () =>
    run(async () => {
      const id = crypto.randomUUID();
      await api("/api/conversations", { method: "POST", body: { id, characterId, personaId } });
      await reload();
      open({ kind: "conversation", id });
    });

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="font-display text-3xl">Valhalla</h1>
        <p className="mt-2 text-faint">
          Write a character. Write who you are when you speak to them. Then speak. Valhalla sends your words and their
          description to Claude and shows you what comes back — it adds nothing, checks nothing and warns about nothing.
        </p>
      </div>

      {health && !health.apiKeyInEnvironment ? (
        <Notice kind="quiet">
          There is no ANTHROPIC_API_KEY in the server&apos;s environment. If you signed in with{" "}
          <span className="font-mono">ant auth login</span>, that is used instead and this is nothing to worry about.
          Otherwise, put the key in <span className="font-mono">dev.env</span> and restart.
        </Notice>
      ) : null}

      {ready ? (
        <section className="space-y-4 rounded border border-rule bg-sheet/50 p-4">
          <h2 className="font-display text-lg">Start a conversation</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="With">
              <select className={inputStyle} value={characterId} onChange={(e) => setCharacterId(e.target.value)}>
                {characters.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="As">
              <select className={inputStyle} value={personaId} onChange={(e) => setPersonaId(e.target.value)}>
                {personas.map((persona) => (
                  <option key={persona.id} value={persona.id}>
                    {persona.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Notice>{error}</Notice>
          <Button kind="strong" onClick={start} disabled={saving}>
            {saving ? "Opening…" : "Open"}
          </Button>
        </section>
      ) : (
        <section className="space-y-3 rounded border border-rule bg-sheet/50 p-4">
          <h2 className="font-display text-lg">Two things first</h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li className={characters.length > 0 ? "text-faint line-through" : ""}>
              A character — their personality, appearance and behavior.
            </li>
            <li className={personas.length > 0 ? "text-faint line-through" : ""}>
              A persona — who you are when you talk to them.
            </li>
          </ol>
          <div className="flex gap-2">
            {characters.length === 0 ? (
              <Button kind="strong" onClick={() => open({ kind: "character", id: null })}>
                New character
              </Button>
            ) : null}
            {personas.length === 0 ? (
              <Button
                kind={characters.length === 0 ? "plain" : "strong"}
                onClick={() => open({ kind: "persona", id: null })}
              >
                New persona
              </Button>
            ) : null}
          </div>
        </section>
      )}
    </div>
  );
}
