import { useState } from "react";
import { Pin } from "lucide-react";
import { LIMITS, type ChatPage } from "../../../shared/protocol.ts";
import { api } from "../../api.ts";
import { Button, Dialog, Field, inputStyle, Notice } from "../../ui/bits.tsx";
import { useSave } from "../../ui/useSave.ts";

/** Pins words from a message: you trim them to what matters, and say who said them. */
export function PinDialog({
  start,
  companionName,
  chatId,
  onClose,
  onPinned,
  onMemory,
  memory,
}: {
  start: { messageId: number; speaker: string; text: string };
  companionName: string;
  chatId: string;
  onClose: () => void;
  onPinned: (page: ChatPage) => void;
  onMemory: () => void;
  /** Whether the companion has memory: without, pins go out right after the profile. */
  memory: boolean;
}) {
  const { error, saving, run } = useSave();
  const [speaker, setSpeaker] = useState(start.speaker);
  const [text, setText] = useState(start.text.slice(0, LIMITS.pinText));
  const tooLong = start.text.length > LIMITS.pinText;

  const pin = () =>
    run(async () => {
      onPinned(
        await api<ChatPage>(`/api/chats/${chatId}/pins`, {
          method: "POST",
          body: { messageId: start.messageId, speaker, text },
        }),
      );
    });

  return (
    <Dialog open onClose={onClose} title="Pin a moment">
      <div className="space-y-4">
        <p className="text-sm text-faint">
          {memory
            ? `A pinned moment is sent, word for word, in every chat with ${companionName}, after the memory. The memory model never rewrites it.`
            : `A pinned moment is sent, word for word, in every chat with ${companionName}, after the profile.`}{" "}
          Keep only the line that matters: every pin is sent every turn.
        </p>
        <Field label="Who said it" hint="As the model should read it: your name in the story, or the companion's.">
          <input
            className={inputStyle}
            value={speaker}
            maxLength={LIMITS.pinSpeaker}
            placeholder={start.speaker ? undefined : "Your name in the story"}
            onChange={(e) => setSpeaker(e.target.value)}
          />
        </Field>
        <Field
          label="The words to keep"
          hint={
            tooLong
              ? `The message is longer than a pin can be (${LIMITS.pinText} characters), so it was cut. Trim it to the part that matters.`
              : `Up to ${LIMITS.pinText} characters.`
          }
        >
          <textarea
            className={`${inputStyle} min-h-28 resize-y leading-relaxed`}
            value={text}
            maxLength={LIMITS.pinText}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        <Notice>{error}</Notice>
        <div className="flex flex-wrap items-center gap-2">
          <Button kind="strong" onClick={pin} disabled={saving || !speaker.trim() || !text.trim()}>
            <Pin size={14} /> {saving ? "Pinning…" : "Pin"}
          </Button>
          <Button kind="quiet" onClick={onClose}>
            Cancel
          </Button>
          <button type="button" className="ml-auto text-sm text-accent hover:underline" onClick={onMemory}>
            See and remove pins on the {memory ? "Memory" : "Pins"} page
          </button>
        </div>
      </div>
    </Dialog>
  );
}
