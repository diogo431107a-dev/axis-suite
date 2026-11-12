import { useCallback, useEffect, useState } from "react";
import { Menu, Plus, X } from "lucide-react";
import type { Character, ConversationSummary, Persona } from "../shared/protocol.ts";
import { api, describeError } from "./api.ts";
import { PageContext, usePage, type Health, type Page, type Selection } from "./page.ts";
import { CharacterForm } from "./forms/CharacterForm.tsx";
import { PersonaForm } from "./forms/PersonaForm.tsx";
import { Conversation } from "./views/Conversation.tsx";
import { Start } from "./views/Start.tsx";
import { About } from "./ui/About.tsx";
import { Button, Notice } from "./ui/bits.tsx";

interface Lists {
  characters: Character[];
  personas: Persona[];
  conversations: ConversationSummary[];
}

const empty: Lists = { characters: [], personas: [], conversations: [] };

export function App() {
  const [lists, setLists] = useState<Lists>(empty);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selection, setSelection] = useState<Selection>({ kind: "none" });
  const [railOpen, setRailOpen] = useState(false);

  const reload = useCallback(async () => {
    const [characters, personas, conversations] = await Promise.all([
      api<Character[]>("/api/characters"),
      api<Persona[]>("/api/personas"),
      api<ConversationSummary[]>("/api/conversations"),
    ]);
    setLists({ characters, personas, conversations });
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const got = await api<Health>("/api/health");
        await reload();
        if (alive) setHealth(got);
      } catch (err) {
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
        Opening Valhalla…
      </p>
    );
  }
  if (loadError) {
    return (
      <div role="alert" className="p-6">
        <Notice>{loadError}</Notice>
      </div>
    );
  }

  const page: Page = { ...lists, health, reload, open };

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
        </nav>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-rule px-3 py-2 md:hidden">
            <button type="button" aria-label="Open the list" onClick={() => setRailOpen(true)} className="text-faint">
              <Menu size={20} />
            </button>
            <span className="font-display">Valhalla</span>
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
    case "conversation":
      return <Conversation key={selection.id} id={selection.id} />;
    case "character":
      return (
        <CharacterForm
          key={selection.id ?? "new"}
          character={lists.characters.find((character) => character.id === selection.id) ?? null}
        />
      );
    case "persona":
      return (
        <PersonaForm
          key={selection.id ?? "new"}
          persona={lists.personas.find((persona) => persona.id === selection.id) ?? null}
        />
      );
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
  const { characters, personas, conversations, open } = usePage();
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
      <Section title="Conversations">
        {conversations.length === 0 ? (
          <p className="px-2 py-1 text-xs text-faint">None yet.</p>
        ) : (
          conversations.map((conversation) =>
            item(
              conversation.id,
              conversation.title,
              `${conversation.characterName} · as ${conversation.personaName}`,
              chosen("conversation", conversation.id),
              () => open({ kind: "conversation", id: conversation.id }),
            ),
          )
        )}
        <div className="px-2 pt-1">
          <Button kind="quiet" onClick={() => open({ kind: "none" })}>
            Start a conversation
          </Button>
        </div>
      </Section>

      <Section title="Characters" onAdd={() => open({ kind: "character", id: null })} addLabel="New character">
        {characters.length === 0 ? (
          <p className="px-2 py-1 text-xs text-faint">None yet.</p>
        ) : (
          characters.map((character) =>
            item(character.id, character.name, null, chosen("character", character.id), () =>
              open({ kind: "character", id: character.id }),
            ),
          )
        )}
      </Section>

      <Section title="Your personas" onAdd={() => open({ kind: "persona", id: null })} addLabel="New persona">
        {personas.length === 0 ? (
          <p className="px-2 py-1 text-xs text-faint">None yet.</p>
        ) : (
          personas.map((persona) =>
            item(persona.id, persona.name, null, chosen("persona", persona.id), () =>
              open({ kind: "persona", id: persona.id }),
            ),
          )
        )}
      </Section>
    </>
  );
}
