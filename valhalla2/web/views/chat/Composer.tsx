// The foot of the chat: what went wrong, the box you write in, and what the chat costs.
import { Send } from "lucide-react";
import {
  LIMITS,
  SPEECH_ENGINE_NAMES,
  type Message,
  type SpeechEngine,
  type TokenView,
} from "../../../shared/protocol.ts";
import { Button, inputStyle, Notice } from "../../ui/bits.tsx";
import { Usage } from "../../ui/Usage.tsx";

export function Composer({
  error,
  filed,
  draft,
  onDraft,
  onSend,
  busy,
  writing,
  companionName,
  last,
  tokens,
  monthChars,
}: {
  error: string;
  filed: string;
  draft: string;
  onDraft: (draft: string) => void;
  onSend: () => void;
  busy: boolean;
  /** Whether a reply is being written. */
  writing: boolean;
  companionName: string;
  /** The last reply on the path. */
  last: Message | null;
  tokens: TokenView | null;
  /** What the engine that read the last reply has read this month. */
  monthChars: { engine: SpeechEngine; chars: number } | null;
}) {
  return (
    <footer className="border-t border-rule px-4 py-3">
      <div className="mx-auto max-w-3xl space-y-2">
        <Notice>{error}</Notice>
        <Notice kind="quiet">{filed}</Notice>
        <div className="flex items-end gap-2">
          <textarea
            className={`${inputStyle} composer max-h-56 min-h-11 resize-none leading-relaxed`}
            value={draft}
            maxLength={LIMITS.message}
            placeholder={`Say something to ${companionName}…`}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
          />
          <Button kind="strong" onClick={onSend} disabled={busy || !draft.trim()}>
            <Send size={15} /> {writing ? "…" : "Send"}
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <Usage last={last?.reply ?? null} tokens={tokens} />
          {monthChars !== null ? (
            <span
              className="font-mono text-xs text-faint"
              title={`Characters ${SPEECH_ENGINE_NAMES[monthChars.engine]} has read aloud for this Valhalla 2 this month, everyone's included.${monthChars.engine === "azure" ? " Azure's free tier (F0) includes 500,000 a month;" : ""} A reply played again costs nothing.`}
            >
              {SPEECH_ENGINE_NAMES[monthChars.engine]} read aloud {monthChars.chars.toLocaleString("en-US")} chars this
              month
            </span>
          ) : null}
          <span className="text-xs text-faint">Enter sends · Shift+Enter for a new line</span>
        </div>
      </div>
    </footer>
  );
}
