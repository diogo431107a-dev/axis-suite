// Asking for a picture: the companion's own API (Claude or Grok) writes the prompt, you look it over
// and change what you like, and only then does CivitAI make it. With scenes (a companion with
// memory), a chat picture is drawn from the moment as its scene model worked it out, which you can
// correct before writing the prompt again; without, from the message itself.
import { useCallback, useEffect, useState } from "react";
import { ImagePlus, RefreshCw } from "lucide-react";
import {
  hasScenes,
  LIMITS,
  ORIENTATIONS,
  type Companion,
  type Orientation,
  type Picture,
  type PictureDraft,
  type PictureDraftReply,
  type SceneView,
} from "../../shared/protocol.ts";
import { api, describeError } from "../api.ts";
import { SeedInput } from "../forms/PictureSettings.tsx";
import { rollSeed } from "../ui/seed.ts";
import { usePage } from "../page.ts";
import { Button, Dialog, Field, inputStyle, Notice } from "../ui/bits.tsx";
import { SceneDialog } from "./chat/SceneDialog.tsx";

/** What the picture is of: the companion alone, or a moment in a chat. */
export type PictureTarget = { kind: "profile" } | { kind: "chat"; chatId: string; messageId: number };

const ORIENTATION_LABELS: Record<Orientation, string> = {
  portrait: "Portrait",
  landscape: "Landscape",
  square: "Square",
};

const money = (dollars: number | null): string =>
  dollars === null ? "" : dollars < 0.01 ? `${(dollars * 100).toFixed(2)}¢` : `$${dollars.toFixed(3)}`;

export function PictureDialog({
  companion,
  target,
  start,
  onClose,
  onMade,
}: {
  companion: Companion;
  target: PictureTarget;
  /** A prompt to start from (making a picture again), instead of asking Claude for one. */
  start?: PictureDraft;
  onClose: () => void;
  onMade: (picture: Picture) => void;
}) {
  const { reload } = usePage();
  const [draft, setDraft] = useState<PictureDraft | null>(start ?? null);
  /** The seed this picture is made with: the companion's, or a fresh roll. It becomes the companion's. */
  const [seed, setSeed] = useState<number | null>(() => companion.settings.pictureSeed ?? rollSeed());
  const [cost, setCost] = useState<number | null>(null);
  const [hint, setHint] = useState("");
  const [writing, setWriting] = useState(false);
  const [making, setMaking] = useState(false);
  const [error, setError] = useState("");
  const [scene, setScene] = useState<SceneView | null>(null);
  /** The scene dialog is open; and whether the scene changed since the prompt was written. */
  const [correcting, setCorrecting] = useState(false);
  const [sceneChanged, setSceneChanged] = useState(false);

  const base = `/api/companions/${companion.id}/pictures`;
  // The target as plain values, so a new object for the same target asks nothing again.
  const chatId = target.kind === "chat" ? target.chatId : null;
  const messageId = target.kind === "chat" ? target.messageId : null;
  const kind = target.kind;

  const write = useCallback(
    async (note: string) => {
      setWriting(true);
      setError("");
      try {
        const reply = await api<PictureDraftReply>(`${base}/prompt`, {
          method: "POST",
          body: { kind, chatId, messageId, hint: note },
        });
        const { cost: spent, scene: read, ...written } = reply;
        setDraft(written);
        setCost(spent);
        setScene(read);
        setSceneChanged(false);
      } catch (err) {
        setError(describeError(err));
      } finally {
        setWriting(false);
      }
    },
    [base, kind, chatId, messageId],
  );

  useEffect(() => {
    if (!start) void write("");
  }, [start, write]);

  const make = async () => {
    if (!draft) return;
    setMaking(true);
    setError("");
    try {
      const picture = await api<Picture>(base, {
        method: "POST",
        body: { kind, chatId, messageId, ...draft, ...(seed === null ? {} : { seed }) },
      });
      onMade(picture);
      onClose();
      // The seed used is now the companion's: the page fetches it for the next picture.
      void reload();
    } catch (err) {
      setError(describeError(err));
      setMaking(false);
    }
  };

  const change = (fields: Partial<PictureDraft>) => setDraft((at) => (at ? { ...at, ...fields } : at));
  const title = target.kind === "profile" ? `A profile picture of ${companion.name}` : "Picture this moment";
  /** Who writes the prompt: the companion's own API. */
  const writer = companion.provider === "xai" ? "Grok" : "Claude";

  return (
    <Dialog open onClose={onClose} title={title}>
      <div className="space-y-4">
        {writing ? (
          <p role="status" className="animate-pulse text-sm text-faint">
            {hasScenes(companion)
              ? `${writer} is picturing the scene and writing the prompt…`
              : `${writer} is writing the prompt…`}
          </p>
        ) : null}

        {draft ? (
          <>
            <Field label="Prompt" hint="What CivitAI draws. Change anything before you make it.">
              <textarea
                className={`${inputStyle} min-h-32 resize-y font-mono text-xs leading-relaxed`}
                value={draft.prompt}
                maxLength={LIMITS.picturePrompt}
                disabled={writing}
                onChange={(e) => change({ prompt: e.target.value })}
              />
            </Field>
            <Field label="Leave out" hint="The negative prompt: what the picture should not have.">
              <textarea
                className={`${inputStyle} min-h-14 resize-y font-mono text-xs leading-relaxed`}
                value={draft.negativePrompt}
                maxLength={LIMITS.picturePrompt}
                disabled={writing}
                onChange={(e) => change({ negativePrompt: e.target.value })}
              />
            </Field>
            <div className="flex flex-wrap items-end gap-4">
              <fieldset className="flex gap-3 text-sm">
                <legend className="mb-1 text-sm font-medium">Shape</legend>
                {ORIENTATIONS.map((option) => (
                  <label key={option} className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      checked={draft.orientation === option}
                      disabled={writing}
                      onChange={() => change({ orientation: option })}
                    />
                    {ORIENTATION_LABELS[option]}
                  </label>
                ))}
              </fieldset>
              <label className="w-56">
                <span className="mb-1 block text-sm font-medium">Seed</span>
                <SeedInput value={seed} onChange={setSeed} placeholder="A new one" disabled={writing} />
              </label>
              <label className="min-w-48 flex-1">
                <span className="mb-1 block text-sm font-medium">Caption</span>
                <input
                  className={inputStyle}
                  value={draft.caption}
                  maxLength={LIMITS.pictureCaption}
                  disabled={writing}
                  onChange={(e) => change({ caption: e.target.value })}
                />
              </label>
            </div>
          </>
        ) : null}

        {scene && chatId !== null && messageId !== null ? (
          <details className="rounded border border-rule p-3 text-sm">
            <summary className="cursor-pointer font-medium">The scene it was drawn from</summary>
            <dl className="mt-2 space-y-1 text-faint">
              {[
                ["Place", scene.sheet.place],
                ["Time", scene.sheet.time],
                ["Weather", scene.sheet.weather],
                ["Light", scene.sheet.light],
                ["Atmosphere", scene.sheet.atmosphere],
                ...scene.sheet.people.map((person) => [
                  person.name,
                  [person.appearance, person.clothes, person.action, person.expression].filter(Boolean).join("; "),
                ]),
              ].map(([label, value], at) => (
                <div key={at}>
                  <dt className="inline text-ink">{label}: </dt>
                  <dd className="inline">{value}</dd>
                </div>
              ))}
            </dl>
            <Button kind="quiet" onClick={() => setCorrecting(true)}>
              Correct the scene
            </Button>
          </details>
        ) : null}
        {sceneChanged ? <Notice kind="quiet">The scene changed. Write the prompt again to draw from it.</Notice> : null}
        {correcting && chatId !== null && messageId !== null ? (
          <SceneDialog
            chatId={chatId}
            messageId={messageId}
            companionName={companion.name}
            onClose={() => setCorrecting(false)}
            onSaved={(saved) => {
              setScene(saved);
              setSceneChanged(true);
            }}
          />
        ) : null}

        <div className="space-y-2 rounded border border-dashed border-rule p-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">A note for {writer}</span>
            <input
              className={inputStyle}
              value={hint}
              maxLength={LIMITS.pictureHint}
              placeholder="At sunset, from behind, in the rain…"
              onChange={(e) => setHint(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button kind="plain" disabled={writing || making} onClick={() => void write(hint)}>
              <RefreshCw size={14} /> {draft ? "Write it again" : "Write the prompt"}
            </Button>
            {cost !== null ? <span className="text-xs text-faint">Writing it cost {money(cost)}.</span> : null}
          </div>
        </div>

        <Notice>{error}</Notice>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            kind="strong"
            disabled={!draft || !draft.prompt.trim() || writing || making}
            onClick={() => void make()}
          >
            <ImagePlus size={15} /> {making ? "Asking CivitAI…" : "Make the picture"}
          </Button>
          <Button kind="quiet" onClick={onClose}>
            Cancel
          </Button>
          <span className="text-xs text-faint">CivitAI charges Buzz for each picture.</span>
        </div>
      </div>
    </Dialog>
  );
}
