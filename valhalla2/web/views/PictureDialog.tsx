// Asking for a picture: Claude writes the prompt, you look it over and change what you like, and
// only then does CivitAI make it.
import { useCallback, useEffect, useState } from "react";
import { ImagePlus, RefreshCw } from "lucide-react";
import {
  LIMITS,
  ORIENTATIONS,
  type Companion,
  type Orientation,
  type Picture,
  type PictureDraft,
  type PictureDraftReply,
} from "../../shared/protocol.ts";
import { api, describeError } from "../api.ts";
import { Button, Dialog, Field, inputStyle, Notice } from "../ui/bits.tsx";

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
  const [draft, setDraft] = useState<PictureDraft | null>(start ?? null);
  const [cost, setCost] = useState<number | null>(null);
  const [hint, setHint] = useState("");
  const [writing, setWriting] = useState(false);
  const [making, setMaking] = useState(false);
  const [error, setError] = useState("");

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
        const { cost: spent, ...written } = reply;
        setDraft(written);
        setCost(spent);
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
      const picture = await api<Picture>(base, { method: "POST", body: { kind, chatId, messageId, ...draft } });
      onMade(picture);
      onClose();
    } catch (err) {
      setError(describeError(err));
      setMaking(false);
    }
  };

  const change = (fields: Partial<PictureDraft>) => setDraft((at) => (at ? { ...at, ...fields } : at));
  const title = target.kind === "profile" ? `A profile picture of ${companion.name}` : "Picture this moment";

  return (
    <Dialog open onClose={onClose} title={title}>
      <div className="space-y-4">
        {writing ? (
          <p role="status" className="animate-pulse text-sm text-faint">
            Claude is picturing the scene and writing the prompt…
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

        <div className="space-y-2 rounded border border-dashed border-rule p-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">A note for Claude</span>
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
