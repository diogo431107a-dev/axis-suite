import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Eye, Settings2, Send } from "lucide-react";
import {
  blockText,
  LIMITS,
  type ConversationPage,
  type Settings,
  type TokenView,
  type Turn,
} from "../../shared/protocol.ts";
import { api, describeError, sendMessage } from "../api.ts";
import { usePage } from "../page.ts";
import { SettingsForm } from "../forms/SettingsForm.tsx";
import { Button, Dialog, inputStyle, Notice } from "../ui/bits.tsx";
import { segmentsOf } from "../ui/emphasis.ts";
import { useSave } from "../ui/useSave.ts";
import { Usage } from "../ui/Usage.tsx";
import { Inspect } from "./Inspect.tsx";

const textOf = (turn: Turn): string => turn.content.map(blockText).join("");

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

/** One stored turn, spoken by whoever said it. */
function Spoken({ turn, who }: { turn: Turn; who: string }) {
  const mine = turn.role === "user";
  const refused = turn.stopReason === "refusal";
  const text = textOf(turn);
  return (
    <article className={mine ? "pl-6 sm:pl-16" : "pr-6 sm:pr-16"}>
      <h3 className={`mb-1 font-display text-sm ${mine ? "text-right text-faint" : "text-accent"}`}>{who}</h3>
      <div
        className={`rounded-lg border px-3.5 py-2.5 ${
          mine ? "border-rule bg-accent-soft" : "border-rule bg-sheet"
        } ${refused ? "border-warn/50" : ""}`}
      >
        {text ? <SpokenText text={text} /> : null}
        {refused ? (
          <div className={text ? "mt-2 border-t border-rule pt-2" : ""}>
            <p className="text-sm text-warn">
              The API declined to answer this turn
              {turn.stopDetails?.category ? ` (${turn.stopDetails.category})` : ""}.
            </p>
            {turn.stopDetails?.explanation ? (
              <p className="mt-1 text-sm text-faint">{turn.stopDetails.explanation}</p>
            ) : null}
            <p className="mt-1 text-xs text-faint">
              This exchange is kept here but not sent again, so the model never sees it. Say it another way.
            </p>
          </div>
        ) : null}
        {turn.stopReason === "max_tokens" ? (
          <p className="mt-2 text-xs text-faint">
            Cut off at the reply length this conversation asks for. Raise it in Settings.
          </p>
        ) : null}
        {turn.servedBy ? (
          <p className="mt-2 text-xs text-faint">
            {turn.declinedBy
              ? `${turn.declinedBy} declined; answered by ${turn.servedBy}.`
              : `Answered by ${turn.servedBy}, which the API keeps using for a while after a decline.`}
          </p>
        ) : null}
      </div>
    </article>
  );
}

export function Conversation({ id }: { id: string }) {
  const { reload } = usePage();
  const [page, setPage] = useState<ConversationPage | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tokens, setTokens] = useState<TokenView | null>(null);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [incoming, setIncoming] = useState("");
  const [sendError, setSendError] = useState("");

  const [showSettings, setShowSettings] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const loadTokens = useCallback(() => {
    api<TokenView>(`/api/conversations/${id}/tokens`)
      .then(setTokens)
      .catch((err: unknown) => {
        // Counting is a courtesy — a conversation that can't count still works, so this never
        // interrupts the page. It is logged rather than swallowed: a count that quietly fails
        // every time is a real fault, and silence is how it stays hidden.
        console.warn("Valhalla could not count this conversation:", err);
        setTokens(null);
      });
  }, [id]);

  // App gives this component a key of the conversation id, so opening another one mounts it
  // afresh and there is nothing to reset here.
  useEffect(() => {
    api<ConversationPage>(`/api/conversations/${id}`)
      .then((loaded) => {
        setPage(loaded);
        loadTokens();
      })
      .catch((err: unknown) => setLoadError(describeError(err)));
  }, [id, loadTokens]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [page?.turns.length, incoming, thinking]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError("");
    setIncoming("");
    setThinking(false);
    let startedId: string | null = null;
    let failed = false;
    try {
      await sendMessage(id, text, (event) => {
        switch (event.type) {
          case "start":
            startedId = event.turn.id;
            setDraft("");
            setPage((at) => (at ? { ...at, turns: [...at.turns, event.turn] } : at));
            break;
          case "thinking":
            setThinking(true);
            break;
          case "delta":
            setThinking(false);
            setIncoming((so_far) => so_far + event.text);
            break;
          case "done":
            setPage((at) => (at ? { ...at, turns: [...at.turns, event.turn] } : at));
            setIncoming("");
            break;
          case "error":
            failed = true;
            setSendError(event.error);
            break;
        }
      });
    } catch (err) {
      failed = true;
      setSendError(describeError(err));
    }
    if (failed) {
      // Nothing was saved, so nothing should be left on screen either. The words come back.
      setPage((at) => (at ? { ...at, turns: at.turns.filter((turn) => turn.id !== startedId) } : at));
      setIncoming("");
      setDraft((current) => current || text);
    }
    setThinking(false);
    setSending(false);
    loadTokens();
    void reload();
  };

  if (loadError) {
    return (
      <div className="p-5">
        <Notice>{loadError}</Notice>
      </div>
    );
  }
  if (!page) return <div className="p-5 text-sm text-faint">Opening…</div>;

  const last = [...page.turns].reverse().find((turn) => turn.role === "assistant") ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-rule px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-lg">{page.conversation.title}</h1>
          <p className="truncate text-xs text-faint">
            {page.character.name} · you are {page.persona.name} · {page.conversation.settings.model}
          </p>
        </div>
        <Button kind="plain" onClick={() => setShowPrompt(true)} title="What gets sent">
          <Eye size={15} /> <span className="hidden sm:inline">Inspect</span>
        </Button>
        <Button kind="plain" onClick={() => setShowSettings(true)} title="Settings">
          <Settings2 size={15} /> <span className="hidden sm:inline">Settings</span>
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-5 p-4">
          {page.turns.length === 0 ? (
            <p className="py-10 text-center text-sm text-faint">
              You speak first. The first message in a conversation has to be yours — the API allows no other opening.
            </p>
          ) : null}
          {page.turns.map((turn) => (
            <Spoken key={turn.id} turn={turn} who={turn.role === "user" ? page.persona.name : page.character.name} />
          ))}
          {thinking && !incoming ? (
            <p className="pr-6 text-sm text-faint sm:pr-16">{page.character.name} is thinking…</p>
          ) : null}
          {incoming ? (
            <article className="pr-6 sm:pr-16">
              <h3 className="mb-1 font-display text-sm text-accent">{page.character.name}</h3>
              <div className="rounded-lg border border-rule bg-sheet px-3.5 py-2.5">
                <SpokenText text={incoming} />
              </div>
            </article>
          ) : null}
          <div ref={bottom} />
        </div>
      </div>

      <footer className="border-t border-rule px-4 py-3">
        <div className="mx-auto max-w-3xl space-y-2">
          <Notice>{sendError}</Notice>
          <div className="flex items-end gap-2">
            <textarea
              className={`${inputStyle} composer max-h-56 min-h-11 resize-none leading-relaxed`}
              value={draft}
              maxLength={LIMITS.message}
              placeholder={`Say something to ${page.character.name}…`}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <Button kind="strong" onClick={() => void send()} disabled={sending || !draft.trim()}>
              <Send size={15} /> {sending ? "…" : "Send"}
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <Usage last={last} tokens={tokens} />
            <span className="text-xs text-faint">Enter sends · Shift+Enter for a new line</span>
          </div>
        </div>
      </footer>

      <Inspect id={id} open={showPrompt} onClose={() => setShowPrompt(false)} />
      <SettingsDialog
        open={showSettings}
        onClose={() => setShowSettings(false)}
        page={page}
        onSaved={(conversation) => {
          setPage((at) => (at ? { ...at, conversation } : at));
          loadTokens();
        }}
      />
    </div>
  );
}

function SettingsDialog({
  open,
  onClose,
  page,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  page: ConversationPage;
  onSaved: (conversation: ConversationPage["conversation"]) => void;
}) {
  const { reload } = usePage();
  const { error, saving, run } = useSave();
  const [settings, setSettings] = useState<Settings>(page.conversation.settings);
  const [title, setTitle] = useState(page.conversation.title);

  const modelChanged = settings.model !== page.conversation.settings.model;
  const effortChanged = settings.effort !== page.conversation.settings.effort;

  const save = () =>
    run(async () => {
      const conversation = await api<ConversationPage["conversation"]>(
        `/api/conversations/${page.conversation.id}/settings`,
        { method: "PATCH", body: settings },
      );
      const renamed =
        title.trim() && title !== page.conversation.title
          ? await api<ConversationPage["conversation"]>(`/api/conversations/${page.conversation.id}`, {
              method: "PATCH",
              body: { title },
            })
          : conversation;
      onSaved(renamed);
      await reload();
      onClose();
    });

  return (
    <Dialog open={open} onClose={onClose} title="This conversation">
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

        <SettingsForm settings={settings} onChange={setSettings} />

        {modelChanged ? (
          <Notice kind="quiet">
            Changing the model starts its cache from nothing — caches belong to one model — and any thinking the old
            model did may be dropped from the history. The conversation itself is kept whole.
          </Notice>
        ) : null}
        {effortChanged && !modelChanged ? (
          <Notice kind="quiet">
            Changing the effort re-sends the conversation at full price once, then caches again.
          </Notice>
        ) : null}

        <Notice>{error}</Notice>

        <div className="flex gap-2">
          <Button kind="strong" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button kind="quiet" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
