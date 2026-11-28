// A moment as the scene model worked it out, for a picture of it: where and when, who is in it and
// how they look, and the atmosphere. By default the character alone: add anyone else you want in
// the picture. Getting it wrong is fixed here: correct what you like and save. It stays as you
// left it.
import { useEffect, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { LIMITS, type ScenePerson, type SceneSheet, type SceneView } from "../../../shared/protocol.ts";
import { api, describeError } from "../../api.ts";
import { Button, Dialog, Field, inputStyle, Notice } from "../../ui/bits.tsx";
import { useSave } from "../../ui/useSave.ts";
import { money } from "../memory/format.ts";

const NOBODY: ScenePerson = { name: "", appearance: "", clothes: "", action: "", mood: "", expression: "" };

export function SceneDialog({
  chatId,
  messageId,
  companionName,
  onClose,
  onSaved,
}: {
  chatId: string;
  messageId: number;
  companionName: string;
  onClose: () => void;
  /** After a correction is saved. */
  onSaved?: (scene: SceneView) => void;
}) {
  const { error, setError, saving, run } = useSave();
  const [scene, setScene] = useState<SceneView | null>(null);
  const [sheet, setSheet] = useState<SceneSheet | null>(null);
  const base = `/api/chats/${chatId}/messages/${messageId}/scene`;

  const show = (view: SceneView) => {
    setScene(view);
    setSheet(view.sheet);
  };

  useEffect(() => {
    // Opening it reads the moment, or shows the reading already kept.
    api<SceneView>(base, { method: "POST" })
      .then(show)
      .catch((err: unknown) => setError(describeError(err)));
  }, [base, setError]);

  const changed = scene !== null && sheet !== null && JSON.stringify(sheet) !== JSON.stringify(scene.sheet);
  const set = (fields: Partial<SceneSheet>) => setSheet((at) => (at ? { ...at, ...fields } : at));
  const setPerson = (at: number, fields: Partial<ScenePerson>) =>
    set({ people: sheet!.people.map((person, n) => (n === at ? { ...person, ...fields } : person)) });

  const save = () =>
    run(async () => {
      const saved = await api<SceneView>(base, { method: "PUT", body: sheet });
      show(saved);
      onSaved?.(saved);
    });

  const again = () =>
    run(async () => {
      show(await api<SceneView>(`${base}/again`, { method: "POST" }));
    });

  const text = (label: string, value: string, onChange: (value: string) => void) => (
    <Field label={label}>
      <input
        className={inputStyle}
        value={value}
        maxLength={LIMITS.sceneField}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );

  return (
    <Dialog open onClose={onClose} title="The scene">
      {!sheet ? (
        error ? null : (
          <p role="status" className="animate-pulse text-sm text-faint">
            Reading the moment…
          </p>
        )
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-faint">
            How this moment was read from the chat and {companionName}'s memory, for a picture of it. The picture shows
            the people listed here: {companionName} alone, unless you add someone. Correct anything, and it stays as you
            leave it.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            {text("Place", sheet.place, (place) => set({ place }))}
            {text("Time", sheet.time, (time) => set({ time }))}
            {text("Weather", sheet.weather, (weather) => set({ weather }))}
            {text("Light", sheet.light, (light) => set({ light }))}
          </div>
          {text("Atmosphere and colours", sheet.atmosphere, (atmosphere) => set({ atmosphere }))}

          <section className="space-y-3">
            <h3 className="font-display">Who is in the picture</h3>
            {sheet.people.map((person, at) => (
              <fieldset key={at} className="space-y-2 rounded border border-rule p-3">
                <div className="flex items-end gap-2">
                  <label className="flex-1">
                    <span className="mb-1 block text-sm font-medium">Name</span>
                    <input
                      className={inputStyle}
                      value={person.name}
                      maxLength={LIMITS.sceneField}
                      onChange={(e) => setPerson(at, { name: e.target.value })}
                    />
                  </label>
                  <Button
                    kind="quiet"
                    title="Not in the picture"
                    onClick={() => set({ people: sheet.people.filter((_, n) => n !== at) })}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {text("Looks", person.appearance, (appearance) => setPerson(at, { appearance }))}
                  {text("Wears", person.clothes, (clothes) => setPerson(at, { clothes }))}
                  {text("Doing", person.action, (action) => setPerson(at, { action }))}
                  {text("Mood", person.mood, (mood) => setPerson(at, { mood }))}
                </div>
                {text("How it shows", person.expression, (expression) => setPerson(at, { expression }))}
              </fieldset>
            ))}
            {sheet.people.length < LIMITS.scenePeople ? (
              <Button kind="quiet" onClick={() => set({ people: [...sheet.people, NOBODY] })}>
                <Plus size={14} /> Someone else
              </Button>
            ) : null}
          </section>

          {scene ? (
            <details className="text-xs text-faint">
              <summary className="cursor-pointer">
                {scene.edited ? "Corrected by you. " : ""}Read by {scene.model}
                {scene.cost !== null ? ` for ${money(scene.cost)}` : ""}. What was sent
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-sheet p-2 font-mono">
                {scene.request.system}
                {"\n\n"}
                {scene.request.prompt}
              </pre>
            </details>
          ) : null}
        </div>
      )}

      <Notice>{error}</Notice>

      {sheet ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button kind="strong" onClick={() => void save()} disabled={saving || !changed}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button kind="quiet" onClick={() => void again()} disabled={saving}>
            <RefreshCw size={14} /> Read it again{scene?.edited ? ", forgetting your corrections" : ""}
          </Button>
        </div>
      ) : null}
    </Dialog>
  );
}
