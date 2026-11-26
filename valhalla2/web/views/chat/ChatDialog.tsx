import { useState } from "react";
import { CHAT_MODES, LIMITS, type Chat as ChatRow, type ChatMode } from "../../../shared/protocol.ts";
import { api } from "../../api.ts";
import { usePage } from "../../page.ts";
import { Button, Dialog, inputStyle, Notice } from "../../ui/bits.tsx";
import { MODE_LABELS } from "../../ui/modes.ts";
import { useSave } from "../../ui/useSave.ts";

export function ChatDialog({
  open,
  onClose,
  chat,
  memory,
  onSaved,
  onCompanion,
}: {
  open: boolean;
  onClose: () => void;
  chat: ChatRow;
  /** Whether the companion has memory: canon or one-shot only matters to memory. */
  memory: boolean;
  onSaved: (chat: ChatRow) => void;
  onCompanion: () => void;
}) {
  const { reload, open: show } = usePage();
  const { error, saving, run } = useSave();
  const [title, setTitle] = useState(chat.title);
  const [mode, setMode] = useState<ChatMode>(chat.mode);
  const [confirming, setConfirming] = useState(false);

  const save = () =>
    run(async () => {
      const changed = await api<ChatRow>(`/api/chats/${chat.id}`, { method: "PATCH", body: { title, mode } });
      onSaved(changed);
      await reload();
      onClose();
    });

  const remove = () =>
    run(async () => {
      await api(`/api/chats/${chat.id}`, { method: "DELETE" });
      await reload();
      show({ kind: "none" });
    });

  return (
    <Dialog open={open} onClose={onClose} title="This chat">
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Title</span>
          <input
            className={inputStyle}
            value={title}
            maxLength={LIMITS.title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <fieldset className={memory ? "space-y-2" : "hidden"}>
          <legend className="mb-1 text-sm font-medium">This chat is</legend>
          {CHAT_MODES.map((option) => (
            <label key={option} className="flex items-start gap-2 text-sm">
              <input type="radio" className="mt-1" checked={mode === option} onChange={() => setMode(option)} />
              <span>
                {MODE_LABELS[option].label}
                <span className="block text-xs text-faint">{MODE_LABELS[option].hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <p className="text-sm text-faint">
          The model, effort, stop sequences and cache belong to the companion, so every chat with them uses the same.{" "}
          <button type="button" className="text-accent hover:underline" onClick={onCompanion}>
            Change them there.
          </button>
        </p>

        <Notice>{error}</Notice>

        <div className="flex flex-wrap items-center gap-2">
          <Button kind="strong" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button kind="quiet" onClick={onClose}>
            Cancel
          </Button>
          <span className="ml-auto flex items-center gap-2">
            {confirming ? (
              <>
                <span className="text-sm text-warn">Delete the whole chat?</span>
                <Button kind="danger" onClick={remove} disabled={saving}>
                  Delete
                </Button>
                <Button kind="quiet" onClick={() => setConfirming(false)}>
                  Keep
                </Button>
              </>
            ) : (
              <Button kind="danger" onClick={() => setConfirming(true)} disabled={saving}>
                Delete chat…
              </Button>
            )}
          </span>
        </div>
      </div>
    </Dialog>
  );
}
