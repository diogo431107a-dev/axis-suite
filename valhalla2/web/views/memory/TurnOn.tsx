// "Turn memory on", for a Grok or GPT companion made without memory. Its memory is built from every
// chat it has had, by its own memory model, and memory is on only once that has worked. It can't be
// turned off again.
import { useState } from "react";
import { Brain } from "lucide-react";
import type { Companion, MemoryPage } from "../../../shared/protocol.ts";
import { api, describeError } from "../../api.ts";
import { Button } from "../../ui/bits.tsx";

export function TurnOn({
  base,
  page,
  companion,
  onPage,
  onError,
}: {
  base: string;
  page: MemoryPage;
  companion: Companion;
  onPage: (page: MemoryPage) => void;
  onError: (error: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);

  const turnOn = async () => {
    setSending(true);
    onError("");
    try {
      onPage(await api<MemoryPage>(`${base}/enable`, { method: "POST" }));
      setConfirming(false);
    } catch (err) {
      onError(describeError(err));
    } finally {
      setSending(false);
    }
  };

  if (page.busy) return null;
  const chats = page.chats === 1 ? `${companion.name}'s one chat` : `all ${page.chats} of ${companion.name}'s chats`;
  return (
    <section className="space-y-2 rounded border border-rule bg-sheet/50 p-3 text-sm">
      {confirming ? (
        <div className="space-y-2">
          <p>
            {page.chats === 0
              ? `${companion.name} gets memory, starting from empty files.`
              : `${companion.settings.memoryModel} reads the selected path of ${chats}, in order, and writes what to remember. It takes a few minutes and costs a few cents a chat, more for long ones.`}{" "}
            Until it finishes, {companion.name}'s chats carry on as now; if any step fails, nothing changes. From then
            on each chat sends its last part, about 60K tokens, with the memory before it, and is folded into memory
            when it goes quiet.
          </p>
          <p className="text-warn">Memory can't be turned off again afterwards.</p>
          <div className="flex gap-2">
            <Button kind="strong" disabled={sending} onClick={() => void turnOn()}>
              {sending ? "Starting…" : "Turn memory on"}
            </Button>
            <Button kind="quiet" onClick={() => setConfirming(false)}>
              Not now
            </Button>
          </div>
        </div>
      ) : (
        <Button kind="plain" onClick={() => setConfirming(true)}>
          <Brain size={14} /> Turn memory on…
        </Button>
      )}
    </section>
  );
}
