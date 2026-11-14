import { useCallback, useEffect, useState } from "react";
import { Menu, Plus, X } from "lucide-react";
import { SignedOutError, fetchMe, goToSignIn, type Me } from "@axis-suite/heimdall-client/browser";
import type { ChatSummary, Companion, Health } from "../shared/protocol.ts";
import { api, describeError } from "./api.ts";
import { PageContext, usePage, type Page, type Selection } from "./page.ts";
import { CompanionForm } from "./forms/CompanionForm.tsx";
import { Chat } from "./views/Chat.tsx";
import { Memory } from "./views/Memory.tsx";
import { Start } from "./views/Start.tsx";
import { About } from "./ui/About.tsx";
import { Button, Notice } from "./ui/bits.tsx";

interface Lists {
  companions: Companion[];
  chats: ChatSummary[];
}

const empty: Lists = { companions: [], chats: [] };

export function App() {
  const [lists, setLists] = useState<Lists>(empty);
  const [health, setHealth] = useState<Health | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selection, setSelection] = useState<Selection>({ kind: "none" });
  const [railOpen, setRailOpen] = useState(false);

  const reload = useCallback(async () => {
    const [companions, chats] = await Promise.all([
      api<Companion[]>("/api/companions"),
      api<ChatSummary[]>("/api/chats"),
    ]);
    setLists({ companions, chats });
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        // Nobody signed in: off to Heimdall, which sends you back here.
        const who = await fetchMe();
        const got = await api<Health>("/api/health");
        await reload();
        if (alive) {
          setMe(who);
          setHealth(got);
        }
      } catch (err) {
        if (err instanceof SignedOutError) return goToSignIn(err);
        if (alive) setLoadError(describeError(err));
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [reload]);

  const open = useCallback((next: Selection) => {
    setSelection(next);
    setRailOpen(false);
  }, []);

  if (loading) {
    return (
      <p role="status" className="p-6 text-sm text-faint">
        Opening Valhalla 2…
      </p>
    );
  }
  if (loadError || !me || !health) {
    return (
      <div role="alert" className="p-6">
        <Notice>{loadError || "Valhalla 2 could not find out who is signed in."}</Notice>
      </div>
    );
  }

  const page: Page = { ...lists, health, me, reload, open };

  return (
    <PageContext.Provider value={page}>
      <div className="flex h-full min-h-0">
        {/* Below 768px the rail slides in over a dimmed backdrop. */}
        {railOpen ? (
          <button
            type="button"
            aria-label="Close the list"
            className="fixed inset-0 z-10 bg-black/40 md:hidden"
            onClick={() => setRailOpen(false)}
          />
        ) : null}
        <nav
          className={`fixed z-20 flex h-full w-72 min-h-0 flex-col border-r border-rule bg-paper
                      transition-transform md:static md:translate-x-0
                      ${railOpen ? "translate-x-0" : "-translate-x-full"}`}
        >
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <About />
            <button
              type="button"
              className="text-faint md:hidden"
              aria-label="Close the list"
              onClick={() => setRailOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            <Rail selection={selection} />
          </div>
          <div className="border-t border-rule px-4 py-3 text-sm">
            <span className="text-ink">{me.name}</span>
            <span className="text-faint"> · </span>
            <a href={me.accountUrl} className="text-faint hover:text-accent">
              Account
            </a>
          </div>
        </nav>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-rule px-3 py-2 md:hidden">
            <button type="button" aria-label="Open the list" onClick={() => setRailOpen(true)} className="text-faint">
              <Menu size={20} />
            </button>
            <span className="font-display">Valhalla 2</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Shown selection={selection} lists={lists} />
          </div>
        </main>
      </div>
    </PageContext.Provider>
  );
}

function Shown({ selection, lists }: { selection: Selection; lists: Lists }) {
  switch (selection.kind) {
    case "chat":
      return <Chat key={selection.id} id={selection.id} greet={selection.greet ?? false} />;
    case "companion":
      return (
        <CompanionForm
          key={selection.id ?? "new"}
          companion={lists.companions.find((companion) => companion.id === selection.id) ?? null}
        />
      );
    case "memory": {
      const companion = lists.companions.find((one) => one.id === selection.companionId);
      return companion ? <Memory key={companion.id} companion={companion} /> : <Start />;
    }
    case "none":
      return <Start />;
  }
}

function Section({
  title,
  onAdd,
  addLabel,
  children,
}: {
  title: string;
  onAdd?: () => void;
  addLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4">
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-faint">{title}</h2>
        {onAdd ? (
          <button
            type="button"
            onClick={onAdd}
            title={addLabel}
            aria-label={addLabel}
            className="text-faint hover:text-accent"
          >
            <Plus size={16} />
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Rail({ selection }: { selection: Selection }) {
  const { companions, chats, open } = usePage();
  const chosen = (kind: Selection["kind"], id: string | null) =>
    selection.kind === kind && "id" in selection && selection.id === id;

  const item = (key: string, label: string, note: string | null, active: boolean, onClick: () => void) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className={`block w-full rounded px-2 py-1.5 text-left text-sm ${
        active ? "bg-accent-soft text-ink" : "hover:bg-sheet"
      }`}
    >
      <span className="block truncate">{label}</span>
      {note ? <span className="block truncate text-xs text-faint">{note}</span> : null}
    </button>
  );

  return (
    <>
      <Section title="Chats">
        {chats.length === 0 ? (
          <p className="px-2 py-1 text-xs text-faint">None yet.</p>
        ) : (
          chats.map((chat) =>
            item(
              chat.id,
              chat.title,
              chat.mode === "one-shot" ? `${chat.companionName} · one-shot` : chat.companionName,
              chosen("chat", chat.id),
              () => open({ kind: "chat", id: chat.id }),
            ),
          )
        )}
        <div className="px-2 pt-1">
          <Button kind="quiet" onClick={() => open({ kind: "none" })}>
            Start a chat
          </Button>
        </div>
      </Section>

      <Section title="Companions" onAdd={() => open({ kind: "companion", id: null })} addLabel="New companion">
        {companions.length === 0 ? (
          <p className="px-2 py-1 text-xs text-faint">None yet.</p>
        ) : (
          companions.map((companion) =>
            item(companion.id, companion.name, null, chosen("companion", companion.id), () =>
              open({ kind: "companion", id: companion.id }),
            ),
          )
        )}
      </Section>
    </>
  );
}
