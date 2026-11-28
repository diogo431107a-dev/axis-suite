// A chat: the selected path through it, the other versions of each message one click away, and
// the composer.
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { BookmarkCheck, Brain, CirclePause, CirclePlay, Eye, Settings2, Volume2, VolumeX } from "lucide-react";
import {
  hasScenes,
  type ChatPage,
  type Message,
  type PathEntry,
  type Picture,
  type PictureDraft,
  type ToneList,
} from "../../../shared/protocol.ts";
import { api, describeError } from "../../api.ts";
import { usePage } from "../../page.ts";
import { Button, Dialog, Notice } from "../../ui/bits.tsx";
import { toClipboard } from "../../ui/clipboard.ts";
import { MODE_LABELS } from "../../ui/modes.ts";
import { PictureView } from "../../ui/pictures.tsx";
import { hasSpeech, useReadAloud, useSpeaker } from "../../ui/speaker.ts";
import { Inspect } from "../Inspect.tsx";
import { PictureDialog } from "../PictureDialog.tsx";
import { ChatDialog } from "./ChatDialog.tsx";
import { Composer } from "./Composer.tsx";
import { Entry } from "./Entry.tsx";
import { Live } from "./Live.tsx";
import { textOf } from "./message.ts";
import { PinDialog } from "./PinDialog.tsx";
import { SceneDialog } from "./SceneDialog.tsx";
import { ToneDialog } from "./ToneDialog.tsx";
import { useChat } from "./useChat.ts";

export function Chat({ id, greet }: { id: string; greet: boolean }) {
  const { open, health } = usePage();
  /** What to do with a reply just written: read it aloud, when that is on. Kept current for write(). */
  const onAnswered = useRef<(message: Message) => void>(() => undefined);
  const {
    page,
    setPage,
    loadError,
    tokens,
    loadTokens,
    draft,
    setDraft,
    writing,
    thinking,
    incoming,
    error,
    setError,
    acting,
    remembering,
    filing,
    filed,
    generate,
    change,
    send,
    rememberNow,
  } = useChat(id, greet, onAnswered);

  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  /** The resume dialog is open: keep what was written while memory was paused, or leave it out. */
  const [resuming, setResuming] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  /** The liked reply whose comment box is open. */
  const [noting, setNoting] = useState<number | null>(null);
  /** The message just copied, which shows a check mark for a moment. */
  const [copied, setCopied] = useState<number | null>(null);
  /** The message something is being pinned from. */
  const [pinning, setPinning] = useState<{ messageId: number; speaker: string; text: string } | null>(null);

  /** The message whose scene is open. */
  const [scening, setScening] = useState<number | null>(null);
  /** The reply whose tags (how each line is read aloud) are open. */
  const [toning, setToning] = useState<number | null>(null);
  /** The replies whose tags have been worked out, the first time each was read aloud with feeling. */
  const [toned, setToned] = useState<number[]>([]);
  /** The message a picture is being asked for, and the prompt to start from when making one again. */
  const [picturing, setPicturing] = useState<{ messageId: number; start?: PictureDraft } | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const loadToned = useCallback(() => {
    if (!health.speech) return;
    api<ToneList>(`/api/chats/${id}/tones`)
      .then((list) => setToned(list.messageIds))
      .catch(() => undefined);
  }, [id, health.speech]);
  useEffect(loadToned, [loadToned]);

  const speaker = useSpeaker(id, setError, loadToned);
  const [readAloud, setReadAloud] = useReadAloud();
  onAnswered.current = (message) => {
    if (health.speech && readAloud && message.role === "assistant" && hasSpeech(textOf(message))) {
      void speaker.play(message.id, true);
    }
  };

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [page?.path.length, incoming, thinking, writing]);

  /** Puts a message's words on the clipboard. */
  const copy = async (messageId: number, text: string) => {
    if ((await toClipboard(text)) === false) {
      setError("This browser wouldn't let Valhalla 2 copy. Select the text and copy it by hand.");
      return;
    }
    setCopied(messageId);
    setTimeout(() => setCopied((at) => (at === messageId ? null : at)), 1500);
  };

  /** Pauses memory in this chat, or resumes it keeping (or not) what was written meanwhile. */
  const pauseOrResume = async (what: "pause" | "resume", keep?: boolean) => {
    setPausing(true);
    setError("");
    try {
      const next = await api<ChatPage>(`/api/chats/${id}/${what}`, {
        method: "POST",
        body: what === "resume" ? { keep } : {},
      });
      setPage(next);
      setResuming(false);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setPausing(false);
    }
  };

  if (loadError) {
    return (
      <div className="p-5">
        <Notice>{loadError}</Notice>
      </div>
    );
  }
  if (!page) return <div className="p-5 text-sm text-faint">Opening…</div>;

  const { chat, companion } = page;
  const busy = writing !== null || acting;

  // While another version of a reply is written, the path is shown up to its parent.
  let shown: PathEntry[] = page.path;
  if (writing?.kind === "generate") {
    const at = writing.parentId === null ? -1 : page.path.findIndex((entry) => entry.message.id === writing.parentId);
    shown = page.path.slice(0, at + 1);
  }
  const last = [...page.path].reverse().find((entry) => entry.message.role === "assistant")?.message ?? null;
  const shownPicture = page.pictures.find((picture) => picture.id === viewing) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-rule px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-lg">{chat.title}</h1>
          <p className="truncate text-xs text-faint">
            {companion.name}
            {companion.memory ? ` · ${MODE_LABELS[chat.mode].label.toLowerCase()}` : ""}
            {chat.memoryPaused ? " · memory paused" : ""} · {companion.settings.model}
          </p>
        </div>
        {health.speech ? (
          <Button
            kind="plain"
            onClick={() => {
              if (readAloud) speaker.stop();
              setReadAloud(!readAloud);
            }}
            title={
              readAloud
                ? "New replies are read aloud as they arrive (on this device). Click to stop that."
                : "New replies arrive silently (on this device). Click to have them read aloud."
            }
          >
            {readAloud ? <Volume2 size={15} /> : <VolumeX size={15} />}{" "}
            <span className="hidden sm:inline">{readAloud ? "Aloud" : "Silent"}</span>
          </Button>
        ) : null}
        {companion.memory ? (
          <Button
            kind="plain"
            onClick={() => {
              if (!chat.memoryPaused) void pauseOrResume("pause");
              // Nothing on the path was written while paused: what is left of it was tried and set aside.
              else if (page.offRecord.paused.length === 0) void pauseOrResume("resume", false);
              else setResuming(true);
            }}
            disabled={pausing || busy}
            title={
              chat.memoryPaused
                ? "Memory is paused: what you write now is held back from it. Click to resume."
                : "Pause memory: what you write from now on is held back from it until you resume, so you can try things out"
            }
          >
            {chat.memoryPaused ? <CirclePlay size={15} /> : <CirclePause size={15} />}{" "}
            <span className="hidden sm:inline">{chat.memoryPaused ? "Resume" : "Pause"}</span>
          </Button>
        ) : null}
        {companion.memory ? (
          <Button
            kind="plain"
            onClick={() => void rememberNow()}
            disabled={filing || busy || !page.memoryPending}
            title={
              page.memoryPending
                ? "Update the companion's memory from this chat now, instead of when it goes quiet"
                : "Memory already has everything in this chat"
            }
          >
            <BookmarkCheck size={15} />{" "}
            <span className="hidden sm:inline">
              {filing ? "Remembering…" : page.memoryPending ? "Remember now" : "Remembered"}
            </span>
          </Button>
        ) : null}
        <Button
          kind="plain"
          onClick={() => open({ kind: "memory", companionId: companion.id })}
          title={companion.memory ? `What ${companion.name} remembers` : `What you pinned for ${companion.name}`}
        >
          <Brain size={15} /> <span className="hidden sm:inline">{companion.memory ? "Memory" : "Pins"}</span>
        </Button>
        <Button kind="plain" onClick={() => setShowPrompt(true)} title="What gets sent">
          <Eye size={15} /> <span className="hidden sm:inline">Inspect</span>
        </Button>
        <Button kind="plain" onClick={() => setShowSettings(true)} title="This chat">
          <Settings2 size={15} /> <span className="hidden sm:inline">Chat</span>
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-5 p-4">
          {page.path.length === 0 && !writing ? (
            <div className="space-y-3 py-10 text-center text-sm text-faint">
              <p>Nothing has been said yet. {companion.name} can open the chat, or you can speak first.</p>
              <Button kind="plain" onClick={() => void generate(null)} disabled={busy}>
                Ask for a greeting
              </Button>
            </div>
          ) : null}
          {shown.map((entry, index) => (
            <Fragment key={entry.message.id}>
              {entry.message.id === page.windowStart ? (
                <p className="border-t border-dashed border-rule pt-2 text-center text-xs text-faint">
                  {companion.memory
                    ? `Everything above has slid out of what is sent each turn. What mattered in it is in ${companion.name}'s memory.`
                    : `Everything above has slid out of what is sent each turn. ${companion.name} has no memory, so no longer sees it.`}
                </p>
              ) : null}
              <Entry
                chatId={id}
                entry={entry}
                isLast={index === shown.length - 1}
                companionName={companion.name}
                busy={busy}
                like={page.liked.find((liked) => liked.messageId === entry.message.id)}
                offRecord={
                  page.offRecord.paused.includes(entry.message.id)
                    ? "paused"
                    : page.offRecord.leftOut.includes(entry.message.id)
                      ? "left-out"
                      : null
                }
                pinned={page.pinned.includes(entry.message.id)}
                pictures={page.pictures.filter((picture) => picture.messageId === entry.message.id)}
                editing={editing}
                setEditing={setEditing}
                noting={noting}
                setNoting={setNoting}
                copied={copied}
                copy={copy}
                deleting={deleting}
                setDeleting={setDeleting}
                speaker={speaker}
                change={change}
                generate={generate}
                onPin={setPinning}
                onPicture={(messageId) => setPicturing({ messageId })}
                onScene={setScening}
                onTone={setToning}
                memory={companion.memory}
                scenes={health.pictures && hasScenes(companion)}
                toned={health.speech && companion.voiceFeeling && toned.includes(entry.message.id)}
                onView={setViewing}
              />
            </Fragment>
          ))}
          <Live
            writing={writing}
            thinking={thinking}
            incoming={incoming}
            remembering={remembering}
            companionName={companion.name}
          />
          <div ref={bottom} />
        </div>
      </div>

      {resuming ? (
        <Dialog open onClose={() => setResuming(false)} title="Resume memory">
          <div className="space-y-4 text-sm">
            <p>
              {page.offRecord.paused.length === 1
                ? "One message on this path was written while memory was paused."
                : `${page.offRecord.paused.length} messages on this path were written while memory was paused.`}{" "}
              Should {companion.name}'s memory have them?
            </p>
            <div className="flex flex-wrap gap-2">
              <Button kind="strong" disabled={pausing} onClick={() => void pauseOrResume("resume", true)}>
                Keep what happened while paused
              </Button>
              <Button kind="plain" disabled={pausing} onClick={() => void pauseOrResume("resume", false)}>
                Leave it out
              </Button>
            </div>
            <p className="text-xs text-faint">
              Kept, it is filed into memory as usual, with the rest of the chat. Left out, memory never reads it, nor
              the likes and reasons given for it; the chat itself keeps it, and {companion.name} still sees it while it
              is in what is sent.
            </p>
          </div>
        </Dialog>
      ) : null}

      <Composer
        error={error}
        filed={filed}
        draft={draft}
        onDraft={setDraft}
        onSend={() => void send()}
        busy={busy}
        writing={writing !== null}
        companionName={companion.name}
        last={last}
        tokens={tokens}
        monthChars={speaker.monthChars}
      />

      <Inspect id={id} open={showPrompt} onClose={() => setShowPrompt(false)} />
      {picturing ? (
        <PictureDialog
          companion={companion}
          target={{ kind: "chat", chatId: chat.id, messageId: picturing.messageId }}
          start={picturing.start}
          onClose={() => setPicturing(null)}
          onMade={(picture: Picture) => setPage((at) => (at ? { ...at, pictures: [...at.pictures, picture] } : at))}
        />
      ) : null}
      {shownPicture ? (
        <PictureView
          picture={shownPicture}
          onClose={() => setViewing(null)}
          onAgain={
            health.pictures && shownPicture.messageId !== null
              ? () => {
                  setPicturing({
                    messageId: shownPicture.messageId!,
                    start: {
                      prompt: shownPicture.prompt,
                      negativePrompt: shownPicture.negativePrompt,
                      orientation: shownPicture.orientation,
                      caption: shownPicture.caption,
                    },
                  });
                  setViewing(null);
                }
              : undefined
          }
          onDelete={async () => {
            try {
              await api(`/api/pictures/${shownPicture.id}`, { method: "DELETE" });
              setViewing(null);
              setPage((at) =>
                at ? { ...at, pictures: at.pictures.filter((picture) => picture.id !== shownPicture.id) } : at,
              );
            } catch (err) {
              setError(describeError(err));
              setViewing(null);
            }
          }}
          extra={
            <Button kind="plain" onClick={() => open({ kind: "gallery", companionId: companion.id })}>
              All pictures
            </Button>
          }
        />
      ) : null}
      {scening !== null ? (
        <SceneDialog
          chatId={chat.id}
          messageId={scening}
          companionName={companion.name}
          onClose={() => setScening(null)}
        />
      ) : null}
      {toning !== null ? (
        <ToneDialog
          chatId={chat.id}
          messageId={toning}
          onClose={() => setToning(null)}
          onHear={() => void speaker.play(toning)}
        />
      ) : null}
      {pinning ? (
        <PinDialog
          start={pinning}
          companionName={companion.name}
          onClose={() => setPinning(null)}
          onPinned={(next) => {
            setPage(next);
            setPinning(null);
            loadTokens();
          }}
          onMemory={() => open({ kind: "memory", companionId: companion.id })}
          memory={companion.memory}
          chatId={chat.id}
        />
      ) : null}
      <ChatDialog
        open={showSettings}
        onClose={() => setShowSettings(false)}
        chat={chat}
        memory={companion.memory}
        onSaved={(changed) => setPage((at) => (at ? { ...at, chat: changed } : at))}
        onCompanion={() => open({ kind: "companion", id: companion.id })}
      />
    </div>
  );
}
