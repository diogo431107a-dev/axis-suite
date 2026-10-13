import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { Keyboard, Menu as MenuIcon, Plus, Settings, Tag, X } from "lucide-react";
import {
  LIMITS,
  type Board,
  type BoardData,
  type Card,
  type CardSummary,
  type Label,
  type List,
} from "../../shared/protocol.ts";
import { ApiFailure, api } from "../api.ts";
import { CardDialog } from "../card/CardDialog.tsx";
import { BoardDialog } from "../dialogs/BoardDialog.tsx";
import { ConfirmDialog } from "../dialogs/ConfirmDialog.tsx";
import { LabelsDialog } from "../dialogs/LabelsDialog.tsx";
import { count } from "../format.ts";
import { go } from "../nav.ts";
import { iconButton, primaryButton, secondaryButton } from "../ui/buttons.ts";
import { cardSpotAt, listIndexAt, startDrag } from "./dnd.ts";
import { intentOf, type Intent } from "./keys.ts";
import { ListColumn } from "./ListColumn.tsx";
import {
  cardPlacement,
  cardsIn,
  listPlacement,
  moveFocus,
  placeCard,
  placeList,
  sameSpot,
  shiftedListIndex,
  shiftedSpot,
  spotOf,
  spotText,
  targetExists,
  withCard,
  withCardChanges,
  withoutCard,
  type Direction,
  type Spot,
  type Target,
} from "./model.ts";
import { createSaver, type Saver } from "./saver.ts";

interface BoardViewProps {
  boardId: string;
  /** the card open over the board, from the address */
  cardId: string | null;
  boards: Board[];
  today: string;
  /** the board's name, colour or existence changed: the sidebar reloads */
  onBoardsChanged: () => void;
  onError: (err: unknown) => void;
  onNotice: (text: string) => void;
  onHelp: () => void;
  onMenu: () => void;
}

type Drag =
  { kind: "card"; id: string; spot: Spot; height: number } | { kind: "list"; id: string; index: number; width: number };

type Confirm = { kind: "card"; card: CardSummary; viaKeys: boolean } | { kind: "list"; list: List; cards: number };

const focusKey = (t: Target) => (t.kind === "card" ? `card:${t.id}` : `${t.kind}:${t.listId}`);

function parseTarget(key: string | undefined): Target | null {
  const [kind, id] = (key ?? "").split(":");
  if (!id) return null;
  if (kind === "card") return { kind, id };
  if (kind === "header" || kind === "add") return { kind, listId: id };
  return null;
}

/** A board: its lists side by side, cards moved by mouse, finger or keyboard. */
export function BoardView(props: BoardViewProps) {
  const { boardId, cardId, today } = props;
  const [data, setData] = useState<BoardData | null | "missing">(null);
  const [focus, setFocus] = useState<Target | null>(null);
  const [held, setHeldState] = useState<{ id: string; origin: Spot } | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [addingList, setAddingList] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [dialog, setDialog] = useState<"board" | "labels" | null>(null);
  const [said, setSaid] = useState("");

  // What the handlers read: always the latest, even between renders.
  const dataRef = useRef<BoardData | null>(null);
  const heldRef = useRef(held);
  const dragRef = useRef(drag);
  const refocus = useRef(false);
  const live = useRef(props);
  live.current = props;
  const reload = useRef(async () => {});

  const commit = useCallback((next: BoardData) => {
    dataRef.current = next;
    setData(next);
  }, []);
  const setHeld = (h: typeof held) => {
    heldRef.current = h;
    setHeldState(h);
  };
  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };
  const say = (text: string) => setSaid((s) => (s === text ? `${text} ` : text));
  const focusTo = (t: Target) => {
    refocus.current = true;
    setFocus(t);
  };

  const [saver] = useState<Saver>(() => {
    const s: Saver = createSaver(
      async (key) => {
        const [kind, id] = key.split(":") as [string, string];
        const d = dataRef.current;
        if (!d) return;
        if (kind === "card" && d.cards.some((c) => c.id === id)) {
          const body = cardPlacement(d, id, (other) => s.pending(`card:${other}`));
          await api(`/api/cards/${id}/move`, { method: "POST", body });
        } else if (kind === "list" && d.lists.some((l) => l.id === id)) {
          const body = listPlacement(d, id, (other) => s.pending(`list:${other}`));
          await api(`/api/lists/${id}/move`, { method: "POST", body });
        }
      },
      (err) => {
        live.current.onError(err);
        void reload.current();
      },
    );
    return s;
  });

  /** Fetches the board, unless moves are still being saved (the next focus fetches it then). */
  const load = useCallback(async () => {
    try {
      const fresh = await api<BoardData>(`/api/boards/${boardId}`);
      if (saver.idle() && !dragRef.current && !heldRef.current) commit(fresh);
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 404) setData("missing");
      else live.current.onError(err);
    }
  }, [boardId, saver, commit]);
  reload.current = load;

  useEffect(() => {
    void load();
    // Back to this tab: changes made in another one show up.
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const board = data && data !== "missing" ? data : null;

  // The board's one tab stop: the focused thing, or the first list's name.
  const tabStop: Target | null =
    board && focus && targetExists(board, focus)
      ? focus
      : board?.lists[0]
        ? { kind: "header", listId: board.lists[0].id }
        : null;

  // After a key moved something, the focus follows it (it may be a new element in another list).
  useLayoutEffect(() => {
    if (!refocus.current || !tabStop) return;
    refocus.current = false;
    const el = document.querySelector<HTMLElement>(`[data-focus="${focusKey(tabStop)}"]`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  if (data === null) return <p className="p-8 text-sm text-stone-400">Opening the board…</p>;
  if (data === "missing") {
    return (
      <div className="p-8 text-sm text-stone-600">
        <p>This board isn't here: it may have been deleted.</p>
        <button type="button" className={`${secondaryButton} mt-3`} onClick={() => go({ boardId: null, cardId: null })}>
          Go to your boards
        </button>
      </div>
    );
  }
  const d = board!;
  const labels = new Map<string, Label>(d.labels.map((l) => [l.id, l]));
  const titleOf = (id: string) => d.cards.find((c) => c.id === id)?.title ?? "The card";

  // ── Moving ───────────────────────────────────────────────────────────────────────────────────

  function moveCard(id: string, dir: Direction) {
    const now = dataRef.current!;
    const spot = shiftedSpot(now, id, dir);
    if (!spot) return say("It can't go further that way.");
    const next = placeCard(now, id, spot);
    commit(next);
    if (!heldRef.current) saver.touch(`card:${id}`);
    say(`${titleOf(id)}: ${spotText(next, id)}`);
    focusTo({ kind: "card", id });
  }

  function moveList(list: List, dir: "left" | "right") {
    const now = dataRef.current!;
    const index = shiftedListIndex(now, list.id, dir);
    if (index === null) return say("It can't go further that way.");
    commit(placeList(now, list.id, index));
    saver.touch(`list:${list.id}`);
    say(`${list.name}: list ${index + 1} of ${now.lists.length}`);
  }

  function drop() {
    const h = heldRef.current;
    if (!h) return;
    setHeld(null);
    const now = dataRef.current!;
    if (!sameSpot(h.origin, spotOf(now, h.id))) saver.touch(`card:${h.id}`);
    say(`Put down ${titleOf(h.id)}: ${spotText(now, h.id)}`);
  }

  function putBack() {
    const h = heldRef.current;
    if (!h) return;
    setHeld(null);
    const next = placeCard(dataRef.current!, h.id, h.origin);
    commit(next);
    say(`${titleOf(h.id)} is back: ${spotText(next, h.id)}`);
  }

  const openCard = (id: string) => go({ boardId, cardId: id });

  function act(intent: Intent, target: Target) {
    const now = dataRef.current!;
    switch (intent.kind) {
      case "focus": {
        const next = moveFocus(now, target, intent.key);
        if (next) focusTo(next);
        return;
      }
      case "move":
        if (target.kind === "card") moveCard(target.id, intent.dir);
        else if (target.kind === "header" && (intent.dir === "left" || intent.dir === "right")) {
          moveList(
            now.lists.find((l) => l.id === target.listId)!,
            intent.dir,
          );
          focusTo(target);
        }
        return;
      case "pick-up":
        if (target.kind !== "card") return;
        setHeld({ id: target.id, origin: spotOf(now, target.id)! });
        say(
          `Picked up ${titleOf(target.id)}: ${spotText(now, target.id)}. ` +
            "Arrow keys move it, Space puts it down, Escape puts it back.",
        );
        return;
      case "drop":
        return drop();
      case "put-back":
        putBack();
        refocus.current = true;
        return;
      case "open":
        if (target.kind === "card") openCard(target.id);
        else if (target.kind === "header") setRenaming(target.listId);
        else setAdding(target.listId);
        return;
      case "new-card":
        setAdding(target.kind === "card" ? spotOf(now, target.id)!.listId : target.listId);
        return;
      case "delete":
        if (target.kind === "card") {
          setConfirm({ kind: "card", card: now.cards.find((c) => c.id === target.id)!, viaKeys: true });
        }
        return;
      case "help":
        return live.current.onHelp();
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    const target = parseTarget((e.target as HTMLElement).dataset.focus);
    if (!target || !dataRef.current) return;
    const intent = intentOf(e, target, heldRef.current !== null);
    if (!intent) return;
    e.preventDefault();
    act(intent, target);
  }

  function onCardBlur(card: CardSummary) {
    // Picked up and then left (a click elsewhere, Tab): put it back. Moving it to another list
    // makes a new element, which takes the focus at once; that doesn't count.
    setTimeout(() => {
      if (heldRef.current?.id !== card.id) return;
      if (document.activeElement?.getAttribute("data-focus") !== `card:${card.id}`) putBack();
    }, 0);
  }

  function onCardPointerDown(card: CardSummary, e: PointerEvent<HTMLElement>) {
    startDrag(e, e.currentTarget, {
      begin: ({ height }) => {
        setHeld(null);
        setDrag({ kind: "card", id: card.id, spot: spotOf(dataRef.current!, card.id)!, height });
      },
      over: (x, y) => {
        const cur = dragRef.current;
        const spot = cardSpotAt(x, y);
        if (spot && cur?.kind === "card" && !sameSpot(cur.spot, spot)) setDrag({ ...cur, spot });
      },
      drop: () => {
        const cur = dragRef.current;
        setDrag(null);
        if (cur?.kind !== "card") return;
        const now = dataRef.current!;
        if (!sameSpot(spotOf(now, cur.id), cur.spot)) {
          const next = placeCard(now, cur.id, cur.spot);
          commit(next);
          saver.touch(`card:${cur.id}`);
          say(`${titleOf(cur.id)}: ${spotText(next, cur.id)}`);
        }
        setFocus({ kind: "card", id: cur.id });
      },
      cancel: () => setDrag(null),
      click: () => openCard(card.id),
    });
  }

  function onHeaderPointerDown(list: List, e: PointerEvent<HTMLElement>, column: HTMLElement) {
    startDrag(e, column, {
      begin: ({ width }) => {
        setHeld(null);
        setDrag({ kind: "list", id: list.id, index: dataRef.current!.lists.indexOf(list), width });
      },
      over: (x) => {
        const cur = dragRef.current;
        const index = listIndexAt(x);
        if (cur?.kind === "list" && cur.index !== index) setDrag({ ...cur, index });
      },
      drop: () => {
        const cur = dragRef.current;
        setDrag(null);
        if (cur?.kind !== "list") return;
        const now = dataRef.current!;
        if (now.lists.findIndex((l) => l.id === cur.id) !== cur.index) {
          commit(placeList(now, cur.id, cur.index));
          saver.touch(`list:${cur.id}`);
        }
      },
      cancel: () => setDrag(null),
      click: () => {},
    });
  }

  // ── Changes ──────────────────────────────────────────────────────────────────────────────────

  async function attempt<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (err) {
      live.current.onError(err);
      return null;
    }
  }

  async function addCard(listId: string, title: string): Promise<boolean> {
    const card = await attempt(() => api<CardSummary>("/api/cards", { method: "POST", body: { listId, title } }));
    if (!card) return false;
    commit(withCard(dataRef.current!, card));
    say(`Added ${card.title}`);
    requestAnimationFrame(() =>
      document.querySelector(`[data-card="${card.id}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" }),
    );
    return true;
  }

  async function addList(name: string): Promise<boolean> {
    const list = await attempt(() => api<List>("/api/lists", { method: "POST", body: { boardId, name } }));
    if (!list) return false;
    const now = dataRef.current!;
    commit({ ...now, lists: [...now.lists, list] });
    requestAnimationFrame(() =>
      document.querySelector(`[data-column="${list.id}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" }),
    );
    return true;
  }

  async function renameList(list: List, name: string) {
    setRenaming(null);
    focusTo({ kind: "header", listId: list.id });
    const saved = await attempt(() => api<List>(`/api/lists/${list.id}`, { method: "PATCH", body: { name } }));
    if (!saved) return;
    const now = dataRef.current!;
    commit({ ...now, lists: now.lists.map((l) => (l.id === saved.id ? saved : l)) });
  }

  async function deleteList(list: List): Promise<boolean> {
    const done = await attempt(() => api(`/api/lists/${list.id}`, { method: "DELETE" }));
    if (done === null) return false;
    const now = dataRef.current!;
    commit({
      ...now,
      lists: now.lists.filter((l) => l.id !== list.id),
      cards: now.cards.filter((c) => c.listId !== list.id),
    });
    props.onNotice(`The list ${list.name} is deleted.`);
    return true;
  }

  async function deleteCard(card: CardSummary, viaKeys: boolean): Promise<boolean> {
    const done = await attempt(() => api(`/api/cards/${card.id}`, { method: "DELETE" }));
    if (done === null) return false;
    const now = dataRef.current!;
    const at = spotOf(now, card.id);
    const next = withoutCard(now, card.id);
    commit(next);
    if (at) {
      const rest = cardsIn(next, at.listId);
      const neighbour = rest[at.index] ?? rest[at.index - 1];
      const target: Target = neighbour ? { kind: "card", id: neighbour.id } : { kind: "add", listId: at.listId };
      if (viaKeys) focusTo(target);
      else setFocus(target);
    }
    if (cardId === card.id) go({ boardId, cardId: null }, true);
    props.onNotice(`${card.title} is deleted.`);
    return true;
  }

  const askDeleteList = (list: List) => {
    const cards = cardsIn(d, list.id).length;
    if (cards === 0) void deleteList(list);
    else setConfirm({ kind: "list", list, cards });
  };

  // ── Page ─────────────────────────────────────────────────────────────────────────────────────

  const columns = [];
  let index = 0;
  for (const list of d.lists) {
    const isDragged = drag?.kind === "list" && drag.id === list.id;
    if (drag?.kind === "list" && !isDragged && drag.index === index) {
      columns.push(<ListGap key="gap" width={drag.width} />);
    }
    if (!isDragged) index++;
    const listIndex = d.lists.indexOf(list);
    columns.push(
      <ListColumn
        key={list.id}
        list={list}
        cards={cardsIn(d, list.id)}
        labels={labels}
        today={today}
        tabStop={tabStop}
        heldId={held?.id ?? null}
        draggingId={drag?.kind === "card" ? drag.id : null}
        gap={
          drag?.kind === "card" && drag.spot.listId === list.id ? { index: drag.spot.index, height: drag.height } : null
        }
        dragging={isDragged}
        renaming={renaming === list.id}
        adding={adding === list.id}
        canMoveLeft={listIndex > 0}
        canMoveRight={listIndex < d.lists.length - 1}
        onCardPointerDown={onCardPointerDown}
        onOpenCard={(c) => openCard(c.id)}
        onFocusTarget={setFocus}
        onCardBlur={onCardBlur}
        onHeaderPointerDown={(e, column) => onHeaderPointerDown(list, e, column)}
        onRenaming={(on) => {
          setRenaming(on ? list.id : null);
          if (!on) focusTo({ kind: "header", listId: list.id });
        }}
        onRename={(name) => void renameList(list, name)}
        onAdding={(on) => {
          setAdding(on ? list.id : null);
          if (!on) focusTo({ kind: "add", listId: list.id });
        }}
        onAdd={(title) => addCard(list.id, title)}
        onMove={(dir) => moveList(list, dir)}
        onDelete={() => askDeleteList(list)}
      />,
    );
  }
  if (drag?.kind === "list" && drag.index >= index) columns.push(<ListGap key="gap" width={drag.width} />);

  const openSummary = cardId ? d.cards.find((c) => c.id === cardId) : undefined;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-1 border-b border-stone-200 bg-white/70 px-3 py-2">
        <button type="button" className={`${iconButton} md:hidden`} aria-label="Menu" onClick={props.onMenu}>
          <MenuIcon className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => setDialog("board")}
          title="Name, colour, export, delete"
          className="min-w-0 truncate rounded-md px-2 py-1 text-lg font-semibold text-stone-800 hover:bg-stone-100"
        >
          {d.board.name}
        </button>
        <span className="flex-1" />
        <button type="button" className={secondaryButton} onClick={() => setDialog("labels")}>
          <Tag className="h-4 w-4" aria-hidden /> <span className="max-sm:sr-only">Labels</span>
        </button>
        <button
          type="button"
          className={iconButton}
          aria-label="Board settings"
          title="Board settings"
          onClick={() => setDialog("board")}
        >
          <Settings className="h-5 w-5" />
        </button>
        <button
          type="button"
          className={iconButton}
          aria-label="Keyboard keys"
          title="Keyboard keys (?)"
          onClick={props.onHelp}
        >
          <Keyboard className="h-5 w-5" />
        </button>
      </header>

      <div
        data-board-scroll
        className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden"
        onKeyDown={onKeyDown}
        role="application"
        aria-roledescription="board"
        aria-label={`${d.board.name}. Arrow keys move between cards, Ctrl+Shift with an arrow moves a card, Space picks one up, question mark lists the keys.`}
      >
        <div className="flex h-full items-start gap-3 p-4">
          {columns}
          <AddList open={addingList} onOpen={setAddingList} onAdd={addList} full={d.lists.length >= LIMITS.lists} />
        </div>
      </div>
      <div aria-live="polite" className="sr-only">
        {said}
      </div>

      {cardId && (
        <CardDialog
          key={cardId}
          cardId={cardId}
          board={d}
          boards={props.boards}
          today={today}
          onChanged={(card: Card) => {
            if (dataRef.current?.cards.some((c) => c.id === card.id)) commit(withCardChanges(dataRef.current, card));
          }}
          onMoved={(toBoard, text) => {
            props.onNotice(text);
            if (toBoard === boardId) void load();
            else {
              commit(withoutCard(dataRef.current!, cardId));
              props.onBoardsChanged();
            }
          }}
          onDelete={() => (openSummary ? deleteCard(openSummary, false) : Promise.resolve(false))}
          onError={props.onError}
          onClose={() => {
            if (focus?.kind === "card" && focus.id === cardId) refocus.current = true;
            go({ boardId, cardId: null });
          }}
        />
      )}

      {confirm?.kind === "card" && (
        <ConfirmDialog
          title="Delete the card"
          message={`Delete the card “${confirm.card.title}”? This can't be undone.`}
          action="Delete the card"
          onConfirm={() => deleteCard(confirm.card, confirm.viaKeys)}
          onClose={() => {
            setConfirm(null);
            if (confirm.viaKeys) refocus.current = true;
          }}
        />
      )}
      {confirm?.kind === "list" && (
        <ConfirmDialog
          title="Delete the list"
          message={`Delete the list “${confirm.list.name}” and its ${count(confirm.cards, "card", "cards")}? This can't be undone.`}
          action="Delete the list"
          onConfirm={() => deleteList(confirm.list)}
          onClose={() => setConfirm(null)}
        />
      )}
      {dialog === "board" && (
        <BoardDialog
          board={d.board}
          stats={{ lists: d.lists.length, cards: d.cards.length }}
          boards={props.boards}
          onSaved={(saved) => {
            commit({ ...dataRef.current!, board: saved });
            props.onBoardsChanged();
          }}
          onDeleted={() => {
            props.onBoardsChanged();
            go({ boardId: null, cardId: null }, true);
          }}
          onError={props.onError}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "labels" && (
        <LabelsDialog
          boardId={boardId}
          labels={d.labels}
          uses={(id) => d.cards.filter((c) => c.labelIds.includes(id)).length}
          onChanged={(next) => {
            const now = dataRef.current!;
            const kept = new Set(next.map((l) => l.id));
            commit({
              ...now,
              labels: next,
              cards: now.cards.map((c) => ({ ...c, labelIds: c.labelIds.filter((id) => kept.has(id)) })),
            });
          }}
          onError={props.onError}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function ListGap({ width }: { width: number }) {
  return (
    <div
      aria-hidden
      className="h-40 shrink-0 rounded-xl border-2 border-dashed border-violet-300 bg-violet-50/70"
      style={{ width }}
    />
  );
}

/** "Add a list" at the end of the board. */
function AddList(props: {
  open: boolean;
  onOpen: (open: boolean) => void;
  onAdd: (name: string) => Promise<boolean>;
  full: boolean;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  if (!props.open) {
    return (
      <button
        type="button"
        disabled={props.full}
        title={props.full ? `At most ${LIMITS.lists} lists on a board` : undefined}
        onClick={() => props.onOpen(true)}
        className="flex w-72 shrink-0 items-center gap-1.5 rounded-xl bg-stone-200/40 px-3 py-2.5 text-sm text-stone-600
          hover:bg-stone-200/80 hover:text-stone-900 disabled:text-stone-300"
      >
        <Plus className="h-4 w-4" aria-hidden /> Add a list
      </button>
    );
  }
  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    const added = await props.onAdd(name.trim());
    setBusy(false);
    if (added) setName("");
  }
  return (
    <form
      className="w-72 shrink-0 space-y-2 rounded-xl bg-stone-200/70 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input
        autoFocus
        aria-label="Name of the new list"
        placeholder="Name of the list…"
        value={name}
        maxLength={LIMITS.nameChars}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            props.onOpen(false);
          }
        }}
        className="block w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm focus:ring-2
          focus:ring-violet-500 focus:outline-none"
      />
      <div className="flex items-center gap-1">
        <button type="submit" className={`${primaryButton} py-1.5`} disabled={busy || !name.trim()}>
          Add list
        </button>
        <button type="button" className={iconButton} aria-label="Stop adding lists" onClick={() => props.onOpen(false)}>
          <X className="h-4 w-4" />
        </button>
      </div>
    </form>
  );
}
