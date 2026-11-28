// How a reply is read aloud: the feeling of each line and how strongly, as the tone model worked it
// out the first time the reply was read with feeling. Correct any line and save, and it is read
// that way from then on. Apart from the scene, which is for pictures.
import { useEffect, useState } from "react";
import { RefreshCw, Volume2 } from "lucide-react";
import {
  FEELINGS,
  STRENGTHS,
  type Feeling,
  type Strength,
  type ToneLine,
  type ToneView,
} from "../../../shared/protocol.ts";
import { api, describeError } from "../../api.ts";
import { Button, Dialog, inputStyle, Notice } from "../../ui/bits.tsx";
import { money } from "../memory/format.ts";
import { useSave } from "../../ui/useSave.ts";

const STRENGTH_LABELS: Record<Strength, string> = { 1: "slight", 2: "clear", 3: "strong" };

export function ToneDialog({
  chatId,
  messageId,
  onClose,
  onHear,
}: {
  chatId: string;
  messageId: number;
  onClose: () => void;
  /** Reads the reply aloud, as the tags now say. */
  onHear: () => void;
}) {
  const { error, setError, saving, run } = useSave();
  const [tone, setTone] = useState<ToneView | null>(null);
  const [lines, setLines] = useState<ToneLine[] | null>(null);
  const base = `/api/chats/${chatId}/messages/${messageId}/tone`;

  const show = (view: ToneView) => {
    setTone(view);
    setLines(view.lines);
  };

  useEffect(() => {
    // The button is offered once the reply has been read with feeling, so this shows what is kept.
    api<ToneView>(base, { method: "POST" })
      .then(show)
      .catch((err: unknown) => setError(describeError(err)));
  }, [base, setError]);

  const changed = tone !== null && lines !== null && JSON.stringify(lines) !== JSON.stringify(tone.lines);
  const setLine = (at: number, fields: Partial<ToneLine>) =>
    setLines((now) => (now ? now.map((line, n) => (n === at ? { ...line, ...fields } : line)) : now));

  const save = (thenHear: boolean) =>
    run(async () => {
      show(await api<ToneView>(base, { method: "PUT", body: { lines } }));
      if (thenHear) onHear();
    });

  const again = () =>
    run(async () => {
      show(await api<ToneView>(`${base}/again`, { method: "POST" }));
    });

  return (
    <Dialog open onClose={onClose} title="How it is read aloud">
      {!lines ? (
        error ? null : (
          <p role="status" className="animate-pulse text-sm text-faint">
            Reading how each line is said…
          </p>
        )
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-faint">
            The feeling each line is read with, and how strongly: Azure reads it louder, softer, quicker or slower to
            match. Correct any line, and it is read that way from then on.
          </p>
          <ol className="space-y-2">
            {lines.map((line, at) => (
              <li key={at} className={`flex flex-wrap items-center gap-2 ${line.paragraph && at > 0 ? "pt-2" : ""}`}>
                <span className={`min-w-0 flex-1 text-sm ${line.action ? "italic text-faint" : ""}`}>{line.text}</span>
                <select
                  aria-label="Feeling"
                  className={`${inputStyle} w-auto py-1 text-sm`}
                  value={line.feeling}
                  onChange={(e) => setLine(at, { feeling: e.target.value as Feeling })}
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
                  onChange={(e) => setLine(at, { strength: Number(e.target.value) as Strength })}
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

          {tone ? (
            <details className="text-xs text-faint">
              <summary className="cursor-pointer">
                {tone.edited ? "Corrected by you. " : ""}Read by {tone.model} at {tone.effort} effort
                {tone.cost !== null ? ` for ${money(tone.cost)}` : ""}. What was sent
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-sheet p-2 font-mono">
                {tone.request.system}
                {"\n\n"}
                {tone.request.prompt}
              </pre>
            </details>
          ) : null}
        </div>
      )}

      <Notice>{error}</Notice>

      {lines ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button kind="strong" onClick={() => void save(false)} disabled={saving || !changed}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button kind="plain" onClick={() => void save(true)} disabled={saving || !changed}>
            <Volume2 size={14} /> Save and hear it
          </Button>
          <Button kind="quiet" onClick={() => void again()} disabled={saving}>
            <RefreshCw size={14} /> Read it again{tone?.edited ? ", forgetting your corrections" : ""}
          </Button>
        </div>
      ) : null}
    </Dialog>
  );
}
