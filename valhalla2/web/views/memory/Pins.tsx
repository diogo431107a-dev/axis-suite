import { useState } from "react";
import { PinOff } from "lucide-react";
import { LIMITS, type Companion, type MemoryPage } from "../../../shared/protocol.ts";
import { api, describeError } from "../../api.ts";
import { usePage } from "../../page.ts";
import { Button } from "../../ui/bits.tsx";
import { when } from "./format.ts";

/** The moments you pinned from chats: sent word for word, never touched by the memory model. */
export function Pins({
  companion,
  page,
  onPage,
  onError,
}: {
  companion: Companion;
  page: MemoryPage;
  onPage: (page: MemoryPage) => void;
  onError: (error: string) => void;
}) {
  const { open } = usePage();
  const [removing, setRemoving] = useState<number | null>(null);

  const remove = async (id: number) => {
    setRemoving(id);
    onError("");
    try {
      onPage(await api<MemoryPage>(`/api/companions/${companion.id}/pins/${id}`, { method: "DELETE" }));
    } catch (err) {
      onError(describeError(err));
    } finally {
      setRemoving(null);
    }
  };

  return (
    <section className="space-y-2">
      <h2 className="font-display text-lg">
        Pinned moments{" "}
        <span className="font-sans text-sm text-faint">
          {page.pins.length} of {LIMITS.pins}
        </span>
      </h2>
      {companion.memory ? (
        <p className="text-sm text-faint">
          Words you pinned from a chat, with the pin under a message. Every chat with {companion.name} gets them word
          for word, after the files above. The memory model never changes them, and a tidy-up or a rebuild leaves them
          as they are. Removing one reaches the chat it came from on its next turn, and the other chats when they next
          look at memory.
        </p>
      ) : (
        <p className="text-sm text-faint">
          Words you pinned from a chat, with the pin under a message. Every chat with {companion.name} gets them word
          for word, after the profile, from its next turn; removing one takes it out the same way.
        </p>
      )}
      {page.pins.length === 0 ? (
        <p className="text-sm text-faint">Nothing is pinned yet.</p>
      ) : (
        <ol className="space-y-2 text-sm">
          {page.pins.map((pin) => (
            <li key={pin.id} className="rounded border border-rule bg-sheet/50 px-3 py-2">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{pin.speaker}</span>
                {pin.chatId ? (
                  <button
                    type="button"
                    className="text-accent hover:underline"
                    onClick={() => open({ kind: "chat", id: pin.chatId! })}
                  >
                    {pin.chatTitle}
                  </button>
                ) : (
                  <span className="text-faint">{pin.chatTitle} (deleted)</span>
                )}
                <span className="text-faint">{when(pin.createdAt)}</span>
                <span className="ml-auto">
                  <Button kind="danger" disabled={removing !== null} onClick={() => void remove(pin.id)}>
                    <PinOff size={14} /> {removing === pin.id ? "Removing…" : "Unpin"}
                  </Button>
                </span>
              </div>
              <p className="spoken mt-1 whitespace-pre-wrap">“{pin.text}”</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
