import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Menu, SendHorizontal } from "lucide-react";
import { LIMITS, type Message, type Person } from "../shared/protocol.ts";
import { api } from "./api.ts";
import { Avatar } from "./Avatar.tsx";
import { dayOf, linkify, timeOf } from "./format.ts";
import { nameOf } from "./people.ts";
import { iconButton } from "./ui/buttons.ts";

/** Messages by the same person this close together are shown as one group. */
const GROUP_MS = 5 * 60_000;

export interface ConversationProps {
  convKey: string;
  /** the header: the conversation's name and anything beside it */
  header: ReactNode;
  /** whether the user can read and write here; otherwise this takes the place of the messages */
  blocked: ReactNode | null;
  /** why the composer is off (a direct conversation with a deleted user), or null */
  readOnly: string | null;
  me: string;
  people: Map<string, Person>;
  /** bumps when the live connection is back: what was missed is fetched again */
  reloadToken: number;
  subscribe: (fn: (m: Message) => void) => () => void;
  onRead: (key: string, id: number) => void;
  onPerson: (username: string) => void;
  onError: (err: unknown) => void;
  onMenu: () => void;
}

export function Conversation(props: ConversationProps) {
  const { convKey, blocked, me, people, reloadToken, subscribe, onRead, onError } = props;
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  // What to do with the scroll position after the next render.
  const scrollPlan = useRef<{ kind: "bottom" } | { kind: "keep"; height: number; top: number } | null>(null);
  const loadingOlder = useRef(false);

  const nearBottom = () => {
    const el = scroller.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  // The latest page, when the conversation opens and after a lost connection.
  useEffect(() => {
    if (blocked) return;
    let cancelled = false;
    api<Message[]>(`/api/messages/${convKey}`)
      .then((page) => {
        if (cancelled) return;
        scrollPlan.current = { kind: "bottom" };
        setMessages(page);
        setHasOlder(page.length >= LIMITS.page);
      })
      .catch((err: unknown) => !cancelled && onError(err));
    return () => {
      cancelled = true;
    };
  }, [convKey, blocked, reloadToken, onError]);

  // New messages, live.
  useEffect(() => {
    if (blocked) return;
    return subscribe((m) => {
      if (m.conv !== convKey) return;
      if (nearBottom() || m.author === me) scrollPlan.current = { kind: "bottom" };
      setMessages((list) => (list && !list.some((x) => x.id === m.id) ? [...list, m] : list));
    });
  }, [convKey, blocked, me, subscribe]);

  useLayoutEffect(() => {
    const el = scroller.current;
    const plan = scrollPlan.current;
    if (!el || !plan) return;
    scrollPlan.current = null;
    if (plan.kind === "bottom") el.scrollTop = el.scrollHeight;
    else el.scrollTop = el.scrollHeight - plan.height + plan.top;
  }, [messages]);

  // Seen: up to the last message, while the tab is visible.
  const lastId = messages?.at(-1)?.id ?? 0;
  useEffect(() => {
    if (blocked) return;
    const mark = () => {
      if (document.visibilityState === "visible" && lastId > 0) onRead(convKey, lastId);
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    window.addEventListener("focus", mark);
    return () => {
      document.removeEventListener("visibilitychange", mark);
      window.removeEventListener("focus", mark);
    };
  }, [convKey, blocked, lastId, onRead]);

  const loadOlder = useCallback(async () => {
    const el = scroller.current;
    const first = messages?.[0];
    if (!el || !first || loadingOlder.current) return;
    loadingOlder.current = true;
    try {
      const page = await api<Message[]>(`/api/messages/${convKey}?before=${first.id}`);
      scrollPlan.current = { kind: "keep", height: el.scrollHeight, top: el.scrollTop };
      setMessages((list) => (list ? [...page, ...list] : page));
      setHasOlder(page.length >= LIMITS.page);
    } catch (err) {
      onError(err);
    } finally {
      loadingOlder.current = false;
    }
  }, [convKey, messages, onError]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex min-h-14 items-center gap-2 border-b border-stone-200 bg-white px-3 py-2">
        <button type="button" className={`${iconButton} md:hidden`} onClick={props.onMenu} aria-label="Open the menu">
          <Menu className="h-5 w-5" />
        </button>
        {props.header}
      </header>

      {blocked ?? (
        <>
          <div
            ref={scroller}
            className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-5"
            onScroll={(e) => {
              if (hasOlder && e.currentTarget.scrollTop < 80) void loadOlder();
            }}
            role="log"
            aria-live="polite"
          >
            {messages === null ? (
              <p className="text-sm text-stone-400">Loading…</p>
            ) : messages.length === 0 ? (
              <p className="text-sm text-stone-400">No messages yet. Say hello!</p>
            ) : (
              <MessageList messages={messages} people={people} onPerson={props.onPerson} />
            )}
          </div>
          <Composer key={convKey} convKey={convKey} readOnly={props.readOnly} onError={onError} />
        </>
      )}
    </div>
  );
}

function MessageList({
  messages,
  people,
  onPerson,
}: {
  messages: Message[];
  people: Map<string, Person>;
  onPerson: (username: string) => void;
}) {
  return (
    <ol className="space-y-0.5">
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const day = dayOf(m.createdAt);
        const newDay = !prev || dayOf(prev.createdAt) !== day;
        const grouped =
          !newDay &&
          prev !== undefined &&
          prev.author === m.author &&
          Date.parse(m.createdAt) - Date.parse(prev.createdAt) < GROUP_MS;
        const person = m.author ? people.get(m.author) : undefined;
        const name = nameOf(person);
        const who = (child: ReactNode) =>
          m.author && person ? (
            <button type="button" onClick={() => onPerson(m.author!)} className="shrink-0 rounded-full">
              {child}
            </button>
          ) : (
            child
          );
        return (
          <Fragment key={m.id}>
            {newDay && (
              <li className="my-3 flex items-center gap-3 text-xs text-stone-400" aria-label={day}>
                <span className="h-px flex-1 bg-stone-200" />
                {day}
                <span className="h-px flex-1 bg-stone-200" />
              </li>
            )}
            <li className={`group flex gap-3 ${grouped ? "" : "pt-2"}`}>
              <div className="w-9 shrink-0">
                {grouped ? (
                  <span className="hidden pt-0.5 text-right text-[10px] text-stone-400 group-hover:block">
                    {timeOf(m.createdAt)}
                  </span>
                ) : (
                  who(<Avatar person={person} />)
                )}
              </div>
              <div className="min-w-0 flex-1">
                {!grouped && (
                  <p className="flex items-baseline gap-2">
                    {who(
                      <span
                        className={`text-sm font-semibold ${person ? "text-stone-800 hover:underline" : "text-stone-400 italic"}`}
                      >
                        {name}
                      </span>,
                    )}
                    <time dateTime={m.createdAt} className="text-xs text-stone-400">
                      {timeOf(m.createdAt)}
                    </time>
                  </p>
                )}
                <p className="text-sm whitespace-pre-wrap break-words text-stone-800">
                  {linkify(m.body).map((piece, j) =>
                    piece.href ? (
                      <a
                        key={j}
                        href={piece.href}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="text-emerald-700 underline"
                      >
                        {piece.text}
                      </a>
                    ) : (
                      <Fragment key={j}>{piece.text}</Fragment>
                    ),
                  )}
                </p>
              </div>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

/** Drafts are kept per conversation while the page is open. */
const drafts = new Map<string, string>();

function Composer({
  convKey,
  readOnly,
  onError,
}: {
  convKey: string;
  readOnly: string | null;
  onError: (err: unknown) => void;
}) {
  const [text, setText] = useState(() => drafts.get(convKey) ?? "");
  const [sending, setSending] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(drafts.get(convKey) ?? "");
    if (matchMedia("(pointer: fine)").matches) area.current?.focus();
  }, [convKey]);

  // Grows with the text, up to a few lines.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    // scrollHeight leaves out the borders.
    el.style.height = `${Math.min(el.scrollHeight + el.offsetHeight - el.clientHeight, 160)}px`;
  }, [text]);

  function change(value: string) {
    setText(value);
    drafts.set(convKey, value);
  }

  async function send() {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await api<Message>(`/api/messages/${convKey}`, { method: "POST", body: { body: text } });
      change("");
    } catch (err) {
      onError(err);
    } finally {
      setSending(false);
      area.current?.focus();
    }
  }

  if (readOnly) {
    return <p className="border-t border-stone-200 bg-stone-100 px-4 py-3 text-sm text-stone-500">{readOnly}</p>;
  }
  const tooLong = [...text].length > LIMITS.messageChars;
  return (
    <form
      className="flex items-end gap-2 border-t border-stone-200 bg-white p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <textarea
        ref={area}
        rows={1}
        value={text}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
        }}
        placeholder="Write a message. Messages can't be edited or deleted."
        aria-label="Message"
        className="min-h-10 flex-1 resize-none rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-800
                   placeholder-stone-400 focus:border-transparent focus:ring-2 focus:ring-emerald-500 focus:outline-none"
      />
      <button
        type="submit"
        disabled={sending || !text.trim() || tooLong}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-700 text-white
                   hover:bg-emerald-800 disabled:bg-stone-200 disabled:text-stone-400"
        aria-label="Send"
        title={tooLong ? `At most ${LIMITS.messageChars} characters` : "Send (Enter)"}
      >
        <SendHorizontal className="h-5 w-5" />
      </button>
    </form>
  );
}
