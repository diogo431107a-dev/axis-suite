// The request exactly as it will be sent.
//
// Nothing here is a reconstruction: the server builds this with the same function it uses to send,
// so what you read is what Claude reads.
import { useEffect, useState } from "react";
import type { PromptView } from "../../shared/protocol.ts";
import { api, describeError } from "../api.ts";
import { Dialog, Notice } from "../ui/bits.tsx";

export function Inspect({ id, open, onClose }: { id: string; open: boolean; onClose: () => void }) {
  const [view, setView] = useState<PromptView | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    api<PromptView>(`/api/conversations/${id}/prompt`)
      .then((got) => {
        setView(got);
        setError("");
      })
      .catch((err: unknown) => setError(describeError(err)));
  }, [id, open]);

  return (
    <Dialog open={open} onClose={onClose} title="What gets sent">
      <Notice>{error}</Notice>
      {view ? (
        <div className="space-y-4 text-sm">
          <p className="text-faint">
            The system prompt, block by block, followed by {view.turns} stored {view.turns === 1 ? "turn" : "turns"} of
            this conversation, sent exactly as they were written.
          </p>
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
          <div className="rounded border border-rule bg-sheet">
            <div className="border-b border-rule px-3 py-1.5 text-xs text-faint">settings</div>
            <pre className="spoken p-3 font-mono text-xs leading-relaxed">{JSON.stringify(view.settings, null, 2)}</pre>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
