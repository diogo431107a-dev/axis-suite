// A chat: the selected path through it, the other versions of each message one click away, and
// the composer.
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  BookmarkCheck,
  Brain,
  ChevronRight,
  Eye,
  GitBranch,
  MessageSquareReply,
  Pencil,
  RefreshCw,
  Send,
  Settings2,
  Trash2,
} from "lucide-react";
import {
  blockText,
  CHAT_MODES,
  LIMITS,
  type Chat as ChatRow,
  type ChatMode,
  type ChatPage,
  type Message,
  type PathEntry,
  type RunOutcome,
  type StreamEvent,
  type TokenView,
} from "../../shared/protocol.ts";
import { api, describeError, streamReply } from "../api.ts";
import { usePage } from "../page.ts";
import { Button, Dialog, inputStyle, Notice } from "../ui/bits.tsx";
import { segmentsOf } from "../ui/emphasis.ts";
import { useSave } from "../ui/useSave.ts";
import { Usage } from "../ui/Usage.tsx";
import { Inspect } from "./Inspect.tsx";
import { MODE_LABELS } from "../ui/modes.ts";

const textOf = (message: Message): string => message.content.map(blockText).join("");

/** Spoken text, with action and ambience set a step back from the dialogue. */
function SpokenText({ text }: { text: string }) {
  return (
    <p className="spoken leading-relaxed">
      {segmentsOf(text).map((segment, at) =>
        segment.action ? (
          <em key={at} className="italic text-faint">
            {segment.text}
          </em>
        ) : (
          <Fragment key={at}>{segment.text}</Fragment>
        ),
      )}
    </p>
  );
}

/** What is being written right now: your message and its answer, or another version of a reply. */
type Writing = { kind: "send"; text: string } | { kind: "generate"; parentId: number | null };

function Bubble({ mine, refused, children }: { mine: boolean; refused?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`rounded-lg border px-3.5 py-2.5 ${mine ? "border-rule bg-accent-soft" : "border-rule bg-sheet"} ${
        refused ? "border-warn/50" : ""
      }`}
    >
      {children}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded p-1 text-faint hover:text-accent disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** What the API said about a reply, under it. */
function ReplyNotes({ message }: { message: Message }) {
  const reply = message.reply;
  return (
    <>
      {reply?.stopReason === "refusal" ? (
        <div className={textOf(message) ? "mt-2 border-t border-rule pt-2" : ""}>
          <p className="text-sm text-warn">
            The API declined to answer this turn
            {reply.stopDetails?.category ? ` (${reply.stopDetails.category})` : ""}.
          </p>
          {reply.stopDetails?.explanation ? (
            <p className="mt-1 text-sm text-faint">{reply.stopDetails.explanation}</p>
          ) : null}
          <p className="mt-1 text-xs text-faint">
            This exchange is kept here but not sent again, so the model never sees it. Ask for another version, or say
            it another way.
          </p>
        </div>
      ) : null}
      {reply?.stopReason === "max_tokens" ? (
        <p className="mt-2 text-xs text-faint">
          Cut off at the reply length this companion asks for. Raise it in its settings.
        </p>
      ) : null}
      {reply?.servedBy ? (
        <p className="mt-2 text-xs text-faint">
          {reply.declinedBy
            ? `${reply.declinedBy} declined; answered by ${reply.servedBy}.`
            : `Answered by ${reply.servedBy}, which the API keeps using for a while after a decline.`}
        </p>
      ) : null}
      {message.instruction && !message.isGreeting ? (
        <p className="mt-2 text-xs text-faint" title={message.instruction}>
          Written with your note on the versions before it.
        </p>
      ) : null}
      {message.editedAt ? <p className="mt-2 text-xs text-faint">Edited.</p> : null}
    </>
  );
}

/** Asks, once, why the versions of a reply keep being rejected. */
function AskWhy({
  onAnswer,
  onSkip,
  disabled,
}: {
  onAnswer: (reason: string) => void;
  onSkip: () => void;
  disabled: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="mt-2 space-y-2 rounded border border-dashed border-accent/60 bg-sheet/50 p-3">
      <p className="text-sm">None of these working? Say why, and the next version will take it into account.</p>
      <textarea
        className={`${inputStyle} min-h-16 resize-y`}
        value={reason}
        maxLength={LIMITS.reason}
        placeholder="Too polite, too long, she wouldn't know that…"
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="flex gap-2">
        <Button kind="strong" onClick={() => onAnswer(reason)} disabled={disabled || !reason.trim()}>
          Try again with this
        </Button>
        <Button kind="quiet" onClick={onSkip} disabled={disabled}>
          Skip
        </Button>
      </div>
    </div>
  );
}

export function Chat({ id, greet }: { id: string; greet: boolean }) {
  const { reload, open } = usePage();
  const [page, setPage] = useState<ChatPage | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tokens, setTokens] = useState<TokenView | null>(null);

  const [draft, setDraft] = useState("");
  const [writing, setWriting] = useState<Writing | null>(null);
  const [thinking, setThinking] = useState(false);
  const [incoming, setIncoming] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [acting, setActing] = useState(false);
  const [remembering, setRemembering] = useState(false);
  const [filing, setFiling] = useState(false);
  const [filed, setFiled] = useState("");

  const [showSettings, setShowSettings] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const greeted = useRef(false);

  const loadTokens = useCallback(() => {
    api<TokenView>(`/api/chats/${id}/tokens`)
      .then(setTokens)
      .catch((err: unknown) => {
        // Counting is a courtesy — a chat that can't count still works, so this never interrupts
        // the page. It is logged rather than swallowed: a count that quietly fails every time is a
        // real fault, and silence is how it stays hidden.
        console.warn("Valhalla 2 could not count this chat:", err);
        setTokens(null);
      });
  }, [id]);

  const load = useCallback(async () => {
    const loaded = await api<ChatPage>(`/api/chats/${id}`);
    setPage(loaded);
    loadTokens();
    return loaded;
  }, [id, loadTokens]);

  /** Streams a reply — POST `path` with `body` — then reads the chat again. */
  const write = useCallback(
    async (what: Writing, path: string, body: unknown): Promise<boolean> => {
      setWriting(what);
      setError("");
      setIncoming("");
      setThinking(false);
      setRemembering(false);
      let failed = false;
      try {
        await streamReply(path, body, (event: StreamEvent) => {
          if (event.type === "remembering") setRemembering(true);
          if (event.type === "thinking") {
            setRemembering(false);
            setThinking(true);
          }
          if (event.type === "delta") {
            setRemembering(false);
            setThinking(false);
            setIncoming((so_far) => so_far + event.text);
          }
          if (event.type === "error") {
            failed = true;
            setError(event.error);
          }
        });
      } catch (err) {
        failed = true;
        setError(describeError(err));
      }
      try {
        await load();
      } catch (err) {
        setError(describeError(err));
      }
      setWriting(null);
      setIncoming("");
      setThinking(false);
      setRemembering(false);
      void reload();
      return !failed;
    },
    [load, reload],
  );

  const generate = useCallback(
    (parentId: number | null) => write({ kind: "generate", parentId }, `/api/chats/${id}/generate`, { parentId }),
    [id, write],
  );

  // App gives this component a key of the chat id, so opening another one mounts it afresh.
  useEffect(() => {
    load()
      .then((loaded) => {
        // A chat that was just opened asks for its greeting straight away.
        if (greet && !greeted.current && loaded.path.length === 0) {
          greeted.current = true;
          void generate(null);
        }
      })
      .catch((err: unknown) => setLoadError(describeError(err)));
  }, [load, greet, generate]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [page?.path.length, incoming, thinking, writing]);

  /** A change to the tree that answers with the chat as it now is. */
  const change = async (path: string, method: string, body?: unknown) => {
    if (acting || writing) return;
    setActing(true);
    setError("");
    try {
      setPage(await api<ChatPage>(path, { method, body }));
      loadTokens();
      void reload();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setActing(false);
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || writing) return;
    setDraft("");
    const ok = await write({ kind: "send", text }, `/api/chats/${id}/send`, { text });
    // Nothing was saved, so the words come back.
    if (!ok) setDraft((current) => current || text);
  };

  /** Folds this chat into the companion's memory now, and says how it went. */
  const rememberNow = async () => {
    setFiling(true);
    setFiled("");
    setError("");
    try {
      const { outcome, page: next } = await api<{ outcome: RunOutcome; page: ChatPage }>(
        `/api/chats/${id}/consolidate`,
        { method: "POST" },
      );
      setPage(next);
      if (outcome.kind === "failed") setError(`Memory was not updated: ${outcome.error}`);
      else if (outcome.kind === "done")
        setFiled(outcome.summary ? `Memory updated. ${outcome.summary}` : "Memory updated.");
      else setFiled(outcome.reason);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setFiling(false);
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

  const entryView = (entry: PathEntry, index: number) => {
    const { message, siblings } = entry;
    const mine = message.role === "user";
    const position = siblings.indexOf(message.id);
    const isLast = index === shown.length - 1;
    const text = textOf(message);
    const refused = message.reply?.stopReason === "refusal";

    return (
      <article key={message.id} className={mine ? "pl-6 sm:pl-16" : "pr-6 sm:pr-16"}>
        <h3 className={`mb-1 font-display text-sm ${mine ? "text-right text-faint" : "text-accent"}`}>
          {mine ? "You" : companion.name}
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
                  void change(`/api/chats/${id}/messages/${message.id}`, "PATCH", { text: editing.text }).then(() =>
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

        <div className={`mt-1 flex flex-wrap items-center gap-1 ${mine ? "justify-end" : ""}`}>
          {siblings.length > 1 || !mine ? (
            <span className="flex items-center text-xs text-faint">
              <IconButton
                label="The version before"
                disabled={busy || position <= 0}
                onClick={() => void change(`/api/chats/${id}/select`, "POST", { messageId: siblings[position - 1] })}
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
                    ? void change(`/api/chats/${id}/select`, "POST", { messageId: siblings[position + 1] })
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
          <IconButton label="Edit" disabled={busy} onClick={() => setEditing({ id: message.id, text })}>
            <Pencil size={14} />
          </IconButton>
          {!isLast && !mine ? (
            <IconButton
              label="Continue from here: what you say next starts a new branch"
              disabled={busy}
              onClick={() => void change(`/api/chats/${id}/branch`, "POST", { messageId: message.id })}
            >
              <GitBranch size={14} />
            </IconButton>
          ) : null}
          {deleting === message.id ? (
            <span className="flex items-center gap-1 text-xs">
              <span className="text-warn">
                {isLast ? "Delete this message?" : "Delete this and everything after it?"}
              </span>
              <Button
                kind="danger"
                disabled={busy}
                onClick={() => {
                  setDeleting(null);
                  void change(`/api/chats/${id}/messages/${message.id}`, "DELETE");
                }}
              >
                Delete
              </Button>
              <Button kind="quiet" onClick={() => setDeleting(null)}>
                Keep
              </Button>
            </span>
          ) : (
            <IconButton label="Delete" disabled={busy} onClick={() => setDeleting(message.id)}>
              <Trash2 size={14} />
            </IconButton>
          )}
        </div>

        {entry.ask && !busy ? (
          <AskWhy
            disabled={busy}
            onSkip={() =>
              void change(`/api/chats/${id}/feedback`, "POST", { parentId: message.parentId, reason: null })
            }
            onAnswer={(reason) => {
              void change(`/api/chats/${id}/feedback`, "POST", { parentId: message.parentId, reason }).then(() =>
                generate(message.parentId),
              );
            }}
          />
        ) : null}
      </article>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-rule px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-lg">{chat.title}</h1>
          <p className="truncate text-xs text-faint">
            {companion.name} · {MODE_LABELS[chat.mode].label.toLowerCase()} · {companion.settings.model}
          </p>
        </div>
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
        <Button
          kind="plain"
          onClick={() => open({ kind: "memory", companionId: companion.id })}
          title={`What ${companion.name} remembers`}
        >
          <Brain size={15} /> <span className="hidden sm:inline">Memory</span>
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
                  Everything above has slid out of what is sent each turn. What mattered in it is in {companion.name}'s
                  memory.
                </p>
              ) : null}
              {entryView(entry, index)}
            </Fragment>
          ))}
          {writing?.kind === "send" ? (
            <article className="pl-6 sm:pl-16">
              <h3 className="mb-1 text-right font-display text-sm text-faint">You</h3>
              <Bubble mine>
                <SpokenText text={writing.text} />
              </Bubble>
            </article>
          ) : null}
          {writing && thinking && !incoming ? (
            <p className="pr-6 text-sm text-faint sm:pr-16">{companion.name} is thinking…</p>
          ) : null}
          {writing && incoming ? (
            <article className="pr-6 sm:pr-16">
              <h3 className="mb-1 font-display text-sm text-accent">{companion.name}</h3>
              <Bubble mine={false}>
                <SpokenText text={incoming} />
              </Bubble>
            </article>
          ) : null}
          {writing && remembering ? (
            <p className="pr-6 text-sm text-faint sm:pr-16">
              {companion.name} is catching up on your other chats first…
            </p>
          ) : null}
          {writing && !remembering && !thinking && !incoming ? (
            <p className="pr-6 text-sm text-faint sm:pr-16">Asking {companion.name}…</p>
          ) : null}
          <div ref={bottom} />
        </div>
      </div>

      <footer className="border-t border-rule px-4 py-3">
        <div className="mx-auto max-w-3xl space-y-2">
          <Notice>{error}</Notice>
          <Notice kind="quiet">{filed}</Notice>
          <div className="flex items-end gap-2">
            <textarea
              className={`${inputStyle} composer max-h-56 min-h-11 resize-none leading-relaxed`}
              value={draft}
              maxLength={LIMITS.message}
              placeholder={`Say something to ${companion.name}…`}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <Button kind="strong" onClick={() => void send()} disabled={busy || !draft.trim()}>
              <Send size={15} /> {writing ? "…" : "Send"}
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <Usage last={last?.reply ?? null} tokens={tokens} />
            <span className="text-xs text-faint">Enter sends · Shift+Enter for a new line</span>
          </div>
        </div>
      </footer>

      <Inspect id={id} open={showPrompt} onClose={() => setShowPrompt(false)} />
      <ChatDialog
        open={showSettings}
        onClose={() => setShowSettings(false)}
        chat={chat}
        onSaved={(changed) => setPage((at) => (at ? { ...at, chat: changed } : at))}
        onCompanion={() => open({ kind: "companion", id: companion.id })}
      />
    </div>
  );
}

function ChatDialog({
  open,
  onClose,
  chat,
  onSaved,
  onCompanion,
}: {
  open: boolean;
  onClose: () => void;
  chat: ChatRow;
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

        <fieldset className="space-y-2">
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
