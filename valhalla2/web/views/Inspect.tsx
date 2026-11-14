// The request exactly as it will be sent.
//
// Nothing here is a reconstruction: the server builds this with the same functions it uses to
// send, so what you read is what Claude reads — including the parts you never see in the chat.
import { useEffect, useState } from "react";
import type { PromptView } from "../../shared/protocol.ts";
import { api, describeError } from "../api.ts";
import { Dialog, Notice } from "../ui/bits.tsx";

const ROLE_NAMES = { user: "you", assistant: "companion", system: "instruction" } as const;

export function Inspect({ id, open, onClose }: { id: string; open: boolean; onClose: () => void }) {
  const [view, setView] = useState<PromptView | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    api<PromptView>(`/api/chats/${id}/prompt`)
      .then((got) => {
        setView(got);
        setError("");
      })
      .catch((err: unknown) => setError(describeError(err)));
  }, [id, open]);

  const hidden = view?.messages.filter((message) => message.hidden).length ?? 0;

  return (
    <Dialog open={open} onClose={onClose} title="What gets sent">
      <Notice>{error}</Notice>
      {view ? (
        <div className="space-y-4 text-sm">
          <p className="text-faint">
            The system prompt, then the {view.messages.length} messages of the selected path
            {hidden > 0 ? `, ${hidden} of them written by Valhalla 2 and never shown in the chat` : ""}. Thinking the
            companion did is sent back too, but isn't shown here.
          </p>
          {view.system.length === 0 ? (
            <Notice kind="quiet">The profile is empty, so there is no system prompt.</Notice>
          ) : null}
          {view.system.map((block, index) => (
            <div key={index} className="rounded border border-rule bg-sheet">
              <div className="flex items-center justify-between gap-3 border-b border-rule px-3 py-1.5 text-xs text-faint">
                <span>system block {index + 1}</span>
                {block.cache_control ? (
                  <span title="The prompt cache is read from here back. Everything above is cheap to re-send.">
                    cache breakpoint · {block.cache_control.ttl}
                  </span>
                ) : null}
              </div>
              <pre className="spoken p-3 font-mono text-xs leading-relaxed">{block.text}</pre>
            </div>
          ))}
          {view.messages.map((message, index) => (
            <div
              key={index}
              className={`rounded border bg-sheet ${message.hidden ? "border-dashed border-accent/60" : "border-rule"}`}
            >
              <div className="border-b border-rule px-3 py-1.5 text-xs text-faint">
                {ROLE_NAMES[message.role]}
                {message.hidden ? " · hidden, written by Valhalla 2" : ""}
              </div>
              <pre className="spoken p-3 font-mono text-xs leading-relaxed">{message.text}</pre>
            </div>
          ))}
          <div className="rounded border border-rule bg-sheet">
            <div className="border-b border-rule px-3 py-1.5 text-xs text-faint">settings</div>
            <pre className="spoken p-3 font-mono text-xs leading-relaxed">{JSON.stringify(view.settings, null, 2)}</pre>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
