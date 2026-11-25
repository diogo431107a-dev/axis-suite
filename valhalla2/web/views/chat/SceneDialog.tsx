// A moment as Claude worked it out: where and when, who is there and how, and how each line of a
// reply is said. A picture of the moment is drawn from it and reading aloud follows it, so getting
// it wrong is fixed here: correct what you like and save. It stays as you left it.
import { useEffect, useState } from "react";
import { Plus, RefreshCw, Trash2, Volume2 } from "lucide-react";
import {
  FEELINGS,
  LIMITS,
  STRENGTHS,
  type Feeling,
  type ScenePerson,
  type SceneSheet,
  type SceneView,
  type Strength,
} from "../../../shared/protocol.ts";
import { api, describeError } from "../../api.ts";
import { Button, Dialog, Field, inputStyle, Notice } from "../../ui/bits.tsx";
import { useSave } from "../../ui/useSave.ts";

const STRENGTH_LABELS: Record<Strength, string> = { 1: "slight", 2: "clear", 3: "strong" };

const money = (dollars: number | null): string =>
  dollars === null ? "" : dollars < 0.01 ? `${(dollars * 100).toFixed(2)}¢` : `$${dollars.toFixed(3)}`;

const NOBODY: ScenePerson = { name: "", appearance: "", clothes: "", action: "", mood: "" };

export function SceneDialog({
  chatId,
  messageId,
  companionName,
  onClose,
  onSaved,
  onHear,
}: {
  chatId: string;
  messageId: number;
  companionName: string;
  onClose: () => void;
  /** After a correction is saved. */
  onSaved?: (scene: SceneView) => void;
  /** Reads the reply aloud, as the scene now says; only offered for a reply with lines. */
  onHear?: () => void;
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

  const save = (thenHear: boolean) =>
    run(async () => {
      const saved = await api<SceneView>(base, { method: "PUT", body: sheet });
      show(saved);
      onSaved?.(saved);
      if (thenHear) onHear?.();
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
            Claude is reading the moment…
          </p>
        )
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-faint">
            How Claude read this moment from the chat and {companionName}'s memory. A picture of it is drawn from this,
            and reading aloud follows how each line is said. Correct anything, and it stays as you leave it.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            {text("Place", sheet.place, (place) => set({ place }))}
            {text("Time", sheet.time, (time) => set({ time }))}
            {text("Weather", sheet.weather, (weather) => set({ weather }))}
            {text("Light", sheet.light, (light) => set({ light }))}
          </div>

          <section className="space-y-3">
            <h3 className="font-display">Who is there</h3>
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
                    title="Not in this moment"
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
              </fieldset>
            ))}
            {sheet.people.length < LIMITS.scenePeople ? (
              <Button kind="quiet" onClick={() => set({ people: [...sheet.people, NOBODY] })}>
                <Plus size={14} /> Someone else
              </Button>
            ) : null}
          </section>

          {sheet.lines.length > 0 ? (
            <section className="space-y-2">
              <h3 className="font-display">How it is said</h3>
              <ol className="space-y-2">
                {sheet.lines.map((line, at) => (
                  <li
                    key={at}
                    className={`flex flex-wrap items-center gap-2 ${line.paragraph && at > 0 ? "pt-2" : ""}`}
                  >
                    <span className={`min-w-0 flex-1 text-sm ${line.action ? "italic text-faint" : ""}`}>
                      {line.text}
                    </span>
                    <select
                      aria-label="Feeling"
                      className={`${inputStyle} w-auto py-1 text-sm`}
                      value={line.feeling}
                      onChange={(e) =>
                        set({
                          lines: sheet.lines.map((one, n) =>
                            n === at ? { ...one, feeling: e.target.value as Feeling } : one,
                          ),
                        })
                      }
                    >
                      {FEELINGS.map((feeling) => (
                        <option key={feeling} value={feeling}>
                          {feeling}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="How strongly"
                      className={`${inputStyle} w-auto py-1 text-sm`}
                      value={line.strength}
                      onChange={(e) =>
                        set({
                          lines: sheet.lines.map((one, n) =>
                            n === at ? { ...one, strength: Number(e.target.value) as Strength } : one,
                          ),
                        })
                      }
                    >
                      {STRENGTHS.map((strength) => (
                        <option key={strength} value={strength}>
                          {STRENGTH_LABELS[strength]}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

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
          <Button kind="strong" onClick={() => void save(false)} disabled={saving || !changed}>
            {saving ? "Saving…" : "Save"}
          </Button>
          {onHear && sheet.lines.length > 0 ? (
            <Button kind="plain" onClick={() => void save(true)} disabled={saving || !changed}>
              <Volume2 size={14} /> Save and hear it
            </Button>
          ) : null}
          <Button kind="quiet" onClick={() => void again()} disabled={saving}>
            <RefreshCw size={14} /> Read it again{scene?.edited ? ", forgetting your corrections" : ""}
          </Button>
        </div>
      ) : null}
    </Dialog>
  );
}
