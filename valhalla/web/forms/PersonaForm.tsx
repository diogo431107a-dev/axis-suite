import { useState } from "react";
import { LIMITS, type Persona } from "../../shared/protocol.ts";
import { api } from "../api.ts";
import { usePage } from "../page.ts";
import { Button, Field, inputStyle, Notice } from "../ui/bits.tsx";
import { useSave } from "../ui/useSave.ts";

const area = `${inputStyle} min-h-32 resize-y font-body leading-relaxed`;

export function PersonaForm({ persona }: { persona: Persona | null }) {
  const { reload, open } = usePage();
  const { error, saving, run } = useSave();
  const [name, setName] = useState(persona?.name ?? "");
  const [description, setDescription] = useState(persona?.description ?? "");
  const [appearance, setAppearance] = useState(persona?.appearance ?? "");

  const save = () =>
    run(async () => {
      const id = persona?.id ?? crypto.randomUUID();
      await api(`/api/personas/${id}`, { method: "PUT", body: { name, description, appearance } });
      await reload();
      open({ kind: "persona", id });
    });

  const remove = () =>
    run(async () => {
      if (!persona) return;
      await api(`/api/personas/${persona.id}`, { method: "DELETE" });
      await reload();
      open({ kind: "none" });
    });

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-5">
      <h1 className="font-display text-2xl">{persona ? persona.name : "A new persona"}</h1>
      <p className="text-sm text-faint">
        Who you are in a conversation. Before a king you might be a servant; in a wolf pack, a wolf. One persona can be
        used with any character.
      </p>

      <Field label="Name">
        <input
          className={inputStyle}
          value={name}
          maxLength={LIMITS.name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Eadric"
        />
      </Field>

      <Field label="Who they are" hint="Your standing, your history, what the other knows of you.">
        <textarea
          className={area}
          value={description}
          maxLength={LIMITS.field}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="A cup-bearer who hears everything in the hall and repeats none of it."
        />
      </Field>

      <Field label="Appearance">
        <textarea
          className={area}
          value={appearance}
          maxLength={LIMITS.field}
          onChange={(e) => setAppearance(e.target.value)}
          placeholder="Thin, in borrowed clothes a size too large."
        />
      </Field>

      <Notice>{error}</Notice>

      <div className="flex items-center gap-2">
        <Button kind="strong" onClick={save} disabled={saving || !name.trim()}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button kind="quiet" onClick={() => open({ kind: "none" })}>
          Cancel
        </Button>
        {persona ? (
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
