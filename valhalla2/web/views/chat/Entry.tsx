// One message on the selected path: its words (or the box to edit them), the buttons under it,
// what you said when you liked it, its pictures, and the question about rejected versions.
import { LIMITS, type Liked, type PathEntry, type Picture } from "../../../shared/protocol.ts";
import { Bubble, Button, inputStyle } from "../../ui/bits.tsx";
import { Thumb } from "../../ui/pictures.tsx";
import type { useSpeaker } from "../../ui/speaker.ts";
import { SpokenText } from "../../ui/SpokenText.tsx";
import { AskWhy } from "./AskWhy.tsx";
import { LikeNote } from "./LikeNote.tsx";
import { MessageActions } from "./MessageActions.tsx";
import { textOf } from "./message.ts";
import { ReplyNotes } from "./ReplyNotes.tsx";

export function Entry({
  chatId,
  entry,
  isLast,
  companionName,
  busy,
  like,
  offRecord,
  pinned,
  pictures,
  editing,
  setEditing,
  noting,
  setNoting,
  copied,
  copy,
  deleting,
  setDeleting,
  speaker,
  change,
  generate,
  onPin,
  onPicture,
  onScene,
  onTone,
  memory,
  scenes,
  toned,
  onView,
}: {
  chatId: string;
  entry: PathEntry;
  isLast: boolean;
  companionName: string;
  busy: boolean;
  like: Liked | undefined;
  /** Held back from memory: written while it was paused, or left out for good. */
  offRecord: "paused" | "left-out" | null;
  pinned: boolean;
  pictures: Picture[];
  editing: { id: number; text: string } | null;
  setEditing: (editing: { id: number; text: string } | null) => void;
  noting: number | null;
  setNoting: (messageId: number | null) => void;
  copied: number | null;
  copy: (messageId: number, text: string) => Promise<void>;
  deleting: number | null;
  setDeleting: (messageId: number | null) => void;
  speaker: ReturnType<typeof useSpeaker>;
  change: (path: string, method: string, body?: unknown) => Promise<void>;
  generate: (parentId: number | null) => Promise<boolean>;
  onPin: (start: { messageId: number; speaker: string; text: string }) => void;
  onPicture: (messageId: number) => void;
  onScene: (messageId: number) => void;
  onTone: (messageId: number) => void;
  /** Whether the companion has memory. */
  memory: boolean;
  /** Whether the companion has scenes, and pictures can be made. */
  scenes: boolean;
  /** Whether this reply's tags (how it is read aloud) can be looked at. */
  toned: boolean;
  onView: (pictureId: string) => void;
}) {
  const { message, siblings } = entry;
  const mine = message.role === "user";
  const text = textOf(message);
  const refused = message.reply?.stopReason === "refusal";
  const likePath = `/api/chats/${chatId}/messages/${message.id}/like`;

  return (
    <article className={mine ? "pl-6 sm:pl-16" : "pr-6 sm:pr-16"}>
      <h3 className={`mb-1 font-display text-sm ${mine ? "text-right text-faint" : "text-accent"}`}>
        {mine ? "You" : companionName}
        {offRecord ? (
          <span
            className="ml-2 font-body text-xs font-normal text-faint"
            title={
              offRecord === "paused"
                ? "Written while memory is paused: memory doesn't read it until you resume and keep it"
                : "Left out of memory: the memory model never reads it"
            }
          >
            {offRecord === "paused" ? "· memory paused" : "· left out of memory"}
          </span>
        ) : null}
      </h3>
      {editing?.id === message.id ? (
        <div className="space-y-2">
          <textarea
            className={`${inputStyle} composer min-h-24 resize-y leading-relaxed`}
            value={editing.text}
            maxLength={LIMITS.message}
            onChange={(e) => setEditing({ id: message.id, text: e.target.value })}
          />
          <div className="flex gap-2">
            <Button
              kind="strong"
              disabled={busy || !editing.text.trim()}
              onClick={() => {
                void change(`/api/chats/${chatId}/messages/${message.id}`, "PATCH", { text: editing.text }).then(() =>
                  setEditing(null),
                );
              }}
            >
              Save
            </Button>
            <Button kind="quiet" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Bubble mine={mine} refused={refused}>
          {text ? <SpokenText text={text} /> : null}
          {mine ? (
            message.editedAt ? (
              <p className="mt-2 text-xs text-faint">Edited.</p>
            ) : null
          ) : (
            <ReplyNotes message={message} />
          )}
        </Bubble>
      )}

      <MessageActions
        chatId={chatId}
        message={message}
        siblings={siblings}
        isLast={isLast}
        text={text}
        companionName={companionName}
        busy={busy}
        liked={like !== undefined}
        pinned={pinned}
        noting={noting === message.id}
        copied={copied === message.id}
        deleting={deleting === message.id}
        speaker={speaker}
        change={change}
        generate={generate}
        onCopy={() => void copy(message.id, text)}
        onNoting={(open) => setNoting(open ? message.id : null)}
        onPin={onPin}
        onEdit={() => setEditing({ id: message.id, text })}
        onPicture={() => onPicture(message.id)}
        onScene={() => onScene(message.id)}
        onTone={() => onTone(message.id)}
        memory={memory}
        scenes={scenes}
        toned={toned}
        onDeleting={(asking) => setDeleting(asking ? message.id : null)}
      />

      {like && noting === message.id ? (
        <LikeNote
          key={`${message.id}:${like.comment ?? ""}`}
          comment={like.comment}
          companionName={companionName}
          disabled={busy}
          onSave={(comment) => void change(likePath, "PUT", { comment: comment || null }).then(() => setNoting(null))}
          onUnlike={() => void change(likePath, "DELETE").then(() => setNoting(null))}
          onClose={() => setNoting(null)}
        />
      ) : like?.comment ? (
        <p className="mt-1 text-xs text-faint italic">You liked: “{like.comment}”</p>
      ) : null}

      {pictures.length > 0 ? (
        <div className={`mt-2 flex flex-wrap gap-2 ${mine ? "justify-end" : ""}`}>
          {pictures.map((picture) => (
            <Thumb key={picture.id} picture={picture} onOpen={() => onView(picture.id)} className="h-44" />
          ))}
        </div>
      ) : null}

      {entry.ask && !busy ? (
        <AskWhy
          disabled={busy}
          onSkip={() =>
            void change(`/api/chats/${chatId}/feedback`, "POST", { parentId: message.parentId, reason: null })
          }
          onAnswer={(reason) => {
            void change(`/api/chats/${chatId}/feedback`, "POST", { parentId: message.parentId, reason }).then(() =>
              generate(message.parentId),
            );
          }}
        />
      ) : null}
    </article>
  );
}
