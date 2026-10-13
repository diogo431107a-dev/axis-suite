import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, ArrowRight, Pencil, Plus, Trash2, X } from "lucide-react";
import { LIMITS, type CardSummary, type Label, type List } from "../../shared/protocol.ts";
import { Menu } from "../ui/Menu.tsx";
import { iconButton, primaryButton } from "../ui/buttons.ts";
import { CardTile } from "./CardTile.tsx";
import { sameTarget, type Target } from "./model.ts";

interface ListColumnProps {
  list: List;
  cards: CardSummary[];
  labels: ReadonlyMap<string, Label>;
  today: string;
  /** what holds the board's tab stop */
  tabStop: Target | null;
  heldId: string | null;
  /** the card being dragged, wherever it is */
  draggingId: string | null;
  /** where a dragged card would land in this list: an index among the others, and its height */
  gap: { index: number; height: number } | null;
  /** this list is being dragged */
  dragging: boolean;
  renaming: boolean;
  adding: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onCardPointerDown: (card: CardSummary, e: ReactPointerEvent<HTMLElement>) => void;
  onOpenCard: (card: CardSummary) => void;
  onFocusTarget: (target: Target) => void;
  onCardBlur: (card: CardSummary) => void;
  /** a press on the list's name: maybe a drag of the whole column */
  onHeaderPointerDown: (e: ReactPointerEvent<HTMLElement>, column: HTMLElement) => void;
  onRenaming: (on: boolean) => void;
  onRename: (name: string) => void;
  onAdding: (on: boolean) => void;
  /** true when the card was made (the field then empties for the next one) */
  onAdd: (title: string) => Promise<boolean>;
  onMove: (dir: "left" | "right") => void;
  onDelete: () => void;
}

/** One list on the board: its name, its cards, and a place to add one. */
export function ListColumn(props: ListColumnProps) {
  const { list, cards, labels, today, tabStop, heldId, draggingId, gap } = props;
  const column = useRef<HTMLElement>(null);
  const header: Target = { kind: "header", listId: list.id };
  const add: Target = { kind: "add", listId: list.id };
  const shownCount = cards.filter((c) => c.id !== draggingId).length;

  const tiles = [];
  let index = 0;
  for (const card of cards) {
    const isDragged = card.id === draggingId;
    if (!isDragged && gap?.index === index) tiles.push(<DropGap key="gap" height={gap.height} />);
    if (!isDragged) index++;
    tiles.push(
      <CardTile
        key={card.id}
        card={card}
        labels={labels}
        today={today}
        tabStop={sameTarget(tabStop, { kind: "card", id: card.id })}
        held={card.id === heldId}
        dragging={isDragged}
        onPointerDown={(e) => props.onCardPointerDown(card, e)}
        onOpen={() => props.onOpenCard(card)}
        onFocus={() => props.onFocusTarget({ kind: "card", id: card.id })}
        onBlur={() => props.onCardBlur(card)}
      />,
    );
  }
  if (gap && gap.index >= index) tiles.push(<DropGap key="gap" height={gap.height} />);

  return (
    <section
      ref={column}
      data-column={list.id}
      data-dragging={props.dragging || undefined}
      aria-label={list.name}
      style={
        props.dragging ? { width: 0, minWidth: 0, margin: "0 0 0 -12px", overflow: "hidden", opacity: 0 } : undefined
      }
      className="flex max-h-full w-72 shrink-0 flex-col rounded-xl bg-stone-200/70"
    >
      <header className="flex items-center gap-1 px-2 pt-2 pb-1">
        {props.renaming ? (
          <RenameField name={list.name} onDone={props.onRename} onCancel={() => props.onRenaming(false)} />
        ) : (
          <div
            data-focus={`header:${list.id}`}
            role="button"
            aria-roledescription="list"
            aria-label={`${list.name}, ${shownCount} ${shownCount === 1 ? "card" : "cards"}`}
            tabIndex={sameTarget(tabStop, header) ? 0 : -1}
            title="Drag to move the list; double-click or Enter to rename"
            onFocus={() => props.onFocusTarget(header)}
            onPointerDown={(e) => props.onHeaderPointerDown(e, column.current!)}
            onDoubleClick={() => props.onRenaming(true)}
            onClick={(e) => e.detail === 0 && props.onRenaming(true)}
            className="flex min-w-0 flex-1 cursor-grab items-baseline gap-2 rounded-md px-2 py-1 select-none
              [-webkit-touch-callout:none] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <h2 className="truncate text-sm font-semibold text-stone-800">{list.name}</h2>
            <span className="text-xs text-stone-500 tabular-nums">{shownCount}</span>
          </div>
        )}
        <Menu
          label={`${list.name} list actions`}
          items={[
            { label: "Rename", icon: <Pencil className="h-4 w-4" />, onSelect: () => props.onRenaming(true) },
            {
              label: "Move left",
              icon: <ArrowLeft className="h-4 w-4" />,
              onSelect: () => props.onMove("left"),
              disabled: !props.canMoveLeft,
            },
            {
              label: "Move right",
              icon: <ArrowRight className="h-4 w-4" />,
              onSelect: () => props.onMove("right"),
              disabled: !props.canMoveRight,
            },
            { label: "Delete…", icon: <Trash2 className="h-4 w-4" />, onSelect: props.onDelete, danger: true },
          ]}
        />
      </header>

      <div data-cards className="flex min-h-1 flex-col gap-2 overflow-y-auto px-2 pt-1 pb-1">
        {tiles}
      </div>

      <div className="p-2">
        {props.adding ? (
          <AddCard onAdd={props.onAdd} onClose={() => props.onAdding(false)} />
        ) : (
          <button
            type="button"
            data-focus={`add:${list.id}`}
            tabIndex={sameTarget(tabStop, add) ? 0 : -1}
            onFocus={() => props.onFocusTarget(add)}
            onClick={() => props.onAdding(true)}
            className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-stone-600 hover:bg-stone-300/60
              hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <Plus className="h-4 w-4" aria-hidden /> Add a card
          </button>
        )}
      </div>
    </section>
  );
}

function DropGap({ height }: { height: number }) {
  return (
    <div
      aria-hidden
      className="shrink-0 rounded-lg border-2 border-dashed border-violet-300 bg-violet-50/70"
      style={{ height }}
    />
  );
}

/** The list's name, being changed: Enter or leaving the field saves, Esc doesn't. */
function RenameField({
  name,
  onDone,
  onCancel,
}: {
  name: string;
  onDone: (name: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(name);
  const field = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => field.current?.select(), []);
  const save = () => {
    if (finished.current) return;
    finished.current = true;
    const value = text.trim();
    if (value && value !== name) onDone(value);
    else onCancel();
  };
  return (
    <input
      ref={field}
      autoFocus
      aria-label="List name"
      value={text}
      maxLength={LIMITS.nameChars}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          save();
        } else if (e.key === "Escape") {
          e.preventDefault();
          finished.current = true;
          onCancel();
        }
      }}
      className="min-w-0 flex-1 rounded-md border border-violet-400 bg-white px-2 py-1 text-sm font-semibold
        text-stone-800 focus:ring-2 focus:ring-violet-500 focus:outline-none"
    />
  );
}

/** Adding cards at the bottom of a list: Enter adds one and stays for the next, Esc closes. */
function AddCard({ onAdd, onClose }: { onAdd: (title: string) => Promise<boolean>; onClose: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  async function submit() {
    const title = text.trim();
    if (!title || busy) return;
    setBusy(true);
    const added = await onAdd(title);
    setBusy(false);
    if (added) setText("");
    field.current?.focus();
  }

  return (
    <div
      className="space-y-2"
      onBlur={(e) => {
        // Leaving it empty closes it.
        if (!e.currentTarget.contains(e.relatedTarget as Node) && !text.trim()) onClose();
      }}
    >
      <textarea
        ref={field}
        autoFocus
        rows={2}
        aria-label="Title of the new card"
        placeholder="Title of the card…"
        value={text}
        maxLength={LIMITS.titleChars}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
        className="block w-full resize-none rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm shadow-sm
          focus:ring-2 focus:ring-violet-500 focus:outline-none"
      />
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={`${primaryButton} py-1.5`}
          disabled={busy || !text.trim()}
          onClick={() => void submit()}
        >
          Add card
        </button>
        <button type="button" className={iconButton} aria-label="Stop adding cards" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
