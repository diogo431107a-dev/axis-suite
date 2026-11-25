// A chat's state, and the ways to change it: reading it, writing a reply as it streams, changing
// the tree, sending, and folding it into memory.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatPage, Message, RunOutcome, StreamEvent, TokenView } from "../../../shared/protocol.ts";
import { api, describeError, streamReply } from "../../api.ts";
import { usePage } from "../../page.ts";
import { useWatched } from "../../ui/watch.ts";

/** What is being written right now: your message and its answer, or another version of a reply. */
export type Writing = { kind: "send"; text: string } | { kind: "generate"; parentId: number | null };

/**
 * `onAnswered` is what to do with a reply just written; the page keeps it current, so write()
 * always calls the latest one.
 */
export function useChat(id: string, greet: boolean, onAnswered: { current: (message: Message) => void }) {
  const { reload } = usePage();
  const [page, setPage] = useState<ChatPage | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tokens, setTokens] = useState<TokenView | null>(null);

  const [draft, setDraft] = useState("");
  const [writing, setWriting] = useState<Writing | null>(null);
  const [thinking, setThinking] = useState(false);
  const [incoming, setIncoming] = useState("");
  const [error, setError] = useState("");
  const [acting, setActing] = useState(false);
  const [remembering, setRemembering] = useState(false);
  const [filing, setFiling] = useState(false);
  const [filed, setFiled] = useState("");
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
      let answered: Message | null = null;
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
          if (event.type === "done") answered = event.message;
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
      if (!failed && answered) onAnswered.current(answered);
      return !failed;
    },
    [load, reload, onAnswered],
  );

  const generate = useCallback(
    (parentId: number | null) => write({ kind: "generate", parentId }, `/api/chats/${id}/generate`, { parentId }),
    [id, write],
  );

  // App gives the page a key of the chat id, so opening another one mounts it afresh.
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

  useWatched(page?.pictures ?? [], (changed) =>
    setPage((at) =>
      at ? { ...at, pictures: at.pictures.map((picture) => (picture.id === changed.id ? changed : picture)) } : at,
    ),
  );

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

  return {
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
  };
}
