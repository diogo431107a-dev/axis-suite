// The row of small buttons under a message.
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Copy,
  GitBranch,
  Heart,
  ImagePlus,
  LoaderCircle,
  MessageSquareReply,
  Pencil,
  Pin,
  RefreshCw,
  Square,
  Trash2,
  Volume2,
} from "lucide-react";
import type { Message } from "../../../shared/protocol.ts";
import { usePage } from "../../page.ts";
import { Button, IconButton } from "../../ui/bits.tsx";
import { hasSpeech, type useSpeaker } from "../../ui/speaker.ts";

export function MessageActions({
  chatId,
  message,
  siblings,
  isLast,
  text,
  companionName,
  busy,
  liked,
  pinned,
  noting,
  copied,
  deleting,
  speaker,
  change,
  generate,
  onCopy,
  onNoting,
  onPin,
  onEdit,
  onPicture,
  onScene,
  memory,
  onDeleting,
}: {
  chatId: string;
  message: Message;
  siblings: number[];
  isLast: boolean;
  text: string;
  companionName: string;
  busy: boolean;
  liked: boolean;
  pinned: boolean;
  /** Whether this message's like note is open. */
  noting: boolean;
  /** Whether this message was just copied. */
  copied: boolean;
  /** Whether this message is asking to be deleted. */
  deleting: boolean;
  speaker: ReturnType<typeof useSpeaker>;
  change: (path: string, method: string, body?: unknown) => Promise<void>;
  generate: (parentId: number | null) => Promise<boolean>;
  onCopy: () => void;
  onNoting: (open: boolean) => void;
  onPin: (start: { messageId: number; speaker: string; text: string }) => void;
  onEdit: () => void;
  onPicture: () => void;
  onScene: () => void;
  /** Whether the companion has memory: without, there is no scene, and a like carries no comment. */
  memory: boolean;
  onDeleting: (asking: boolean) => void;
}) {
  const { health } = usePage();
  const mine = message.role === "user";
  const position = siblings.indexOf(message.id);
  const refused = message.reply?.stopReason === "refusal";
  const likePath = `/api/chats/${chatId}/messages/${message.id}/like`;

  return (
    <div className={`mt-1 flex flex-wrap items-center gap-1 ${mine ? "justify-end" : ""}`}>
      {siblings.length > 1 || !mine ? (
        <span className="flex items-center text-xs text-faint">
          <IconButton
            label="The version before"
            disabled={busy || position <= 0}
            onClick={() => void change(`/api/chats/${chatId}/select`, "POST", { messageId: siblings[position - 1] })}
          >
            <ChevronLeft size={15} />
          </IconButton>
          <span className="min-w-8 text-center font-mono">
            {position + 1}/{siblings.length}
          </span>
          <IconButton
            label={position < siblings.length - 1 ? "The version after" : "Write another version"}
            disabled={busy || (mine && position >= siblings.length - 1)}
            onClick={() =>
              position < siblings.length - 1
                ? void change(`/api/chats/${chatId}/select`, "POST", { messageId: siblings[position + 1] })
                : void generate(message.parentId)
            }
          >
            <ChevronRight size={15} />
          </IconButton>
        </span>
      ) : null}
      {!mine ? (
        <IconButton label="Write another version" disabled={busy} onClick={() => void generate(message.parentId)}>
          <RefreshCw size={14} />
        </IconButton>
      ) : null}
      {mine && isLast ? (
        <IconButton label="Ask for an answer" disabled={busy} onClick={() => void generate(message.id)}>
          <MessageSquareReply size={14} />
        </IconButton>
      ) : null}
      {text ? (
        <IconButton label={copied ? "Copied" : "Copy"} onClick={onCopy}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </IconButton>
      ) : null}
      {!mine && text.trim() && !refused ? (
        <IconButton
          label={liked ? (memory ? "Liked. Change the comment or unlike" : "Liked. Click to unlike") : "Like"}
          disabled={busy}
          onClick={() => {
            if (!memory) {
              void change(likePath, liked ? "DELETE" : "PUT", liked ? undefined : {});
              return;
            }
            if (noting) {
              onNoting(false);
              return;
            }
            if (!liked) void change(likePath, "PUT", {});
            onNoting(true);
          }}
        >
          <Heart size={14} className={liked ? "fill-current text-accent" : undefined} />
        </IconButton>
      ) : null}
      {text && !refused ? (
        <IconButton
          label={pinned ? "Pinned. Pin more of it" : "Pin: keep these words, as they are, in every chat"}
          disabled={busy}
          onClick={() => onPin({ messageId: message.id, speaker: mine ? "" : companionName, text: text.trim() })}
        >
          <Pin size={14} className={pinned ? "fill-current text-accent" : undefined} />
        </IconButton>
      ) : null}
      <IconButton label="Edit" disabled={busy} onClick={onEdit}>
        <Pencil size={14} />
      </IconButton>
      {!isLast && !mine ? (
        <IconButton
          label="Continue from here: what you say next starts a new branch"
          disabled={busy}
          onClick={() => void change(`/api/chats/${chatId}/branch`, "POST", { messageId: message.id })}
        >
          <GitBranch size={14} />
        </IconButton>
      ) : null}
      {health.speech && !mine && hasSpeech(text) ? (
        speaker.playing?.messageId === message.id ? (
          <IconButton label={speaker.playing.phase === "loading" ? "Reading…" : "Stop reading"} onClick={speaker.stop}>
            {speaker.playing.phase === "loading" ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : (
              <Square size={13} />
            )}
          </IconButton>
        ) : (
          <IconButton label="Read aloud" onClick={() => void speaker.play(message.id)}>
            <Volume2 size={14} />
          </IconButton>
        )
      ) : null}
      {health.pictures && text ? (
        <IconButton label="Picture this moment" disabled={busy} onClick={onPicture}>
          <ImagePlus size={14} />
        </IconButton>
      ) : null}
      {memory && text && !refused ? (
        <IconButton label="The scene: where, who, and how it is said" disabled={busy} onClick={onScene}>
          <Clapperboard size={14} />
        </IconButton>
      ) : null}
      {deleting ? (
        <span className="flex items-center gap-1 text-xs">
          <span className="text-warn">{isLast ? "Delete this message?" : "Delete this and everything after it?"}</span>
          <Button
            kind="danger"
            disabled={busy}
            onClick={() => {
              onDeleting(false);
              void change(`/api/chats/${chatId}/messages/${message.id}`, "DELETE");
            }}
          >
            Delete
          </Button>
          <Button kind="quiet" onClick={() => onDeleting(false)}>
            Keep
          </Button>
        </span>
      ) : (
        <IconButton label="Delete" disabled={busy} onClick={() => onDeleting(true)}>
          <Trash2 size={14} />
        </IconButton>
      )}
    </div>
  );
}
