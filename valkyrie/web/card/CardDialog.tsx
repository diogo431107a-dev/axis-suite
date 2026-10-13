import { useEffect, useRef, useState } from "react";
import { AlignLeft, ArrowRightLeft, CalendarClock, CheckSquare, Tag, Trash2 } from "lucide-react";
import {
  LIMITS,
  type Board,
  type BoardData,
  type Card,
  type CardMoved,
  type CardPatch,
  type ChecklistItem,
} from "../../shared/protocol.ts";
import { ApiFailure, api } from "../api.ts";
import { cardsIn } from "../board/model.ts";
import { COLOR_CLASSES } from "../colors.ts";
import { count } from "../format.ts";
import { DateField } from "../inputs/DateField.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { closeDialog } from "../ui/closeDialog.ts";
import { dangerButton, field, label, primaryButton, secondaryButton } from "../ui/buttons.ts";
import { Checklist } from "./Checklist.tsx";

interface CardDialogProps {
  cardId: string;
  board: BoardData;
  boards: Board[];
  today: string;
  /** the card changed: the board shows it */
  onChanged: (card: Card) => void;
  /** it went to another place (on this board or another), described in `text` */
  onMoved: (boardId: string, text: string) => void;
  onDelete: () => Promise<boolean>;
  onError: (err: unknown) => void;
  onClose: () => void;
}

/**
 * A card with everything on it. Each change is saved on its own, at once; if the card changed in
 * another tab meanwhile, the dialog shows it as it is now and says so.
 */
export function CardDialog(props: CardDialogProps) {
  const { cardId, board, today, onError } = props;
  const [card, setCardState] = useState<Card | null | "missing">(null);
  const [notice, setNotice] = useState("");
  const [moving, setMoving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cardRef = useRef<Card | null>(null);
  // Edits go out one after another, each with the rev the one before it got back.
  const chain = useRef(Promise.resolve());

  const setCard = (c: Card) => {
    cardRef.current = c;
    setCardState(c);
  };
  const changed = (c: Card) => {
    setCard(c);
    props.onChanged(c);
  };

  useEffect(() => {
    let stale = false;
    api<Card>(`/api/cards/${cardId}`).then(
      (c) => {
        if (stale) return;
        cardRef.current = c;
        setCardState(c);
      },
      (err: unknown) => {
        if (stale) return;
        if (err instanceof ApiFailure && err.status === 404) setCardState("missing");
        else onError(err);
      },
    );
    return () => {
      stale = true;
    };
  }, [cardId, onError]);

  function patch(fields: Omit<CardPatch, "rev">) {
    chain.current = chain.current.then(async () => {
      const cur = cardRef.current;
      if (!cur) return;
      try {
        changed(await api<Card>(`/api/cards/${cur.id}`, { method: "PATCH", body: { ...fields, rev: cur.rev } }));
      } catch (err) {
        if (err instanceof ApiFailure && err.code === "conflict" && err.body?.card) {
          changed(err.body.card);
          setNotice(
            "This card was changed in another tab. This is how it is now; make your change again if it's still needed.",
          );
        } else onError(err);
      }
    });
  }

  /** A checklist change: saved, then shown. */
  async function itemChange<T>(fn: () => Promise<T>, apply: (items: ChecklistItem[], result: T) => ChecklistItem[]) {
    try {
      const result = await fn();
      const cur = cardRef.current!;
      changed({ ...cur, items: apply(cur.items, result) });
      return true;
    } catch (err) {
      onError(err);
      return false;
    }
  }

  if (card === "missing" || card === null) {
    return (
      <Dialog title="Card" onClose={props.onClose}>
        <p className="text-sm text-stone-500">
          {card === null ? "Opening the card…" : "This card isn't here: it may have been deleted."}
        </p>
      </Dialog>
    );
  }

  const list = board.lists.find((l) => l.id === card.listId);
  const labelSet = new Set(card.labelIds);

  return (
    <Dialog title={list ? `In ${list.name}` : "Card"} onClose={props.onClose} wide>
      <div className="space-y-5">
        {notice && (
          <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {notice}
          </p>
        )}

        <TitleField key={`title-${card.rev}`} title={card.title} onSave={(title) => patch({ title })} />

        <section>
          <h3 className={`${label} flex items-center gap-1`}>
            <Tag className="h-3.5 w-3.5" aria-hidden /> Labels
          </h3>
          {board.labels.length === 0 ? (
            <p className="text-sm text-stone-400">This board has no labels yet (Labels, above the board).</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {board.labels.map((l) => {
                const on = labelSet.has(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    aria-pressed={on}
                    aria-label={l.name || l.color}
                    title={l.name || l.color}
                    onClick={() =>
                      patch({ labelIds: on ? card.labelIds.filter((id) => id !== l.id) : [...card.labelIds, l.id] })
                    }
                    className={`h-7 min-w-10 rounded-md px-2 text-xs font-medium transition ${COLOR_CLASSES[l.color].chip} ${
                      on ? "ring-2 ring-stone-800 ring-offset-1" : "opacity-35 hover:opacity-70"
                    }`}
                  >
                    {l.name}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <h3 className={`${label} flex items-center gap-1`}>
            <CalendarClock className="h-3.5 w-3.5" aria-hidden /> Due date
          </h3>
          {card.dueDate ? (
            <div className="flex flex-wrap items-center gap-2">
              <DateField
                value={card.dueDate}
                onChange={(dueDate) => dueDate !== card.dueDate && patch({ dueDate })}
                today={today}
                label="Due date"
              />
              {card.dueDate < today && <span className="text-xs font-medium text-red-700">Overdue</span>}
              {card.dueDate === today && <span className="text-xs font-medium text-amber-700">Today</span>}
              <button type="button" className={secondaryButton} onClick={() => patch({ dueDate: null })}>
                Remove
              </button>
            </div>
          ) : (
            <button type="button" className={secondaryButton} onClick={() => patch({ dueDate: today })}>
              Add a due date
            </button>
          )}
        </section>

        <section>
          <h3 className={`${label} flex items-center gap-1`}>
            <AlignLeft className="h-3.5 w-3.5" aria-hidden /> Description
          </h3>
          <DescriptionField
            key={`description-${card.rev}`}
            text={card.description}
            onSave={(description) => patch({ description })}
          />
        </section>

        <section>
          <h3 className={`${label} flex items-center gap-1`}>
            <CheckSquare className="h-3.5 w-3.5" aria-hidden /> Checklist
          </h3>
          <Checklist
            items={card.items}
            onAdd={(text) =>
              itemChange(
                () => api<ChecklistItem>(`/api/cards/${card.id}/items`, { method: "POST", body: { text } }),
                (items, item) => [...items, item],
              )
            }
            onChange={(item, change) => {
              // Ticks show at once.
              if (change.done !== undefined) {
                const cur = cardRef.current!;
                changed({ ...cur, items: cur.items.map((i) => (i.id === item.id ? { ...i, ...change } : i)) });
              }
              void itemChange(
                () => api<ChecklistItem>(`/api/items/${item.id}`, { method: "PATCH", body: change }),
                (items, saved) => items.map((i) => (i.id === saved.id ? saved : i)),
              );
            }}
            onDelete={(item) =>
              void itemChange(
                () => api(`/api/items/${item.id}`, { method: "DELETE" }),
                (items) => items.filter((i) => i.id !== item.id),
              )
            }
            onMove={(item, index) => {
              const others = cardRef.current!.items.filter((i) => i.id !== item.id);
              const afterId = index === 0 ? null : others[index - 1]!.id;
              const cur = cardRef.current!;
              changed({ ...cur, items: [...others.slice(0, index), item, ...others.slice(index)] });
              void itemChange(
                () => api<ChecklistItem[]>(`/api/items/${item.id}/move`, { method: "POST", body: { afterId } }),
                (_items, saved) => saved,
              );
            }}
          />
        </section>

        {moving && (
          <MoveSection
            card={card}
            board={board}
            boards={props.boards}
            onError={onError}
            onMoved={(boardId, text, dialog) => {
              props.onMoved(boardId, text);
              if (boardId === board.board.id) {
                setMoving(false);
                void api<Card>(`/api/cards/${card.id}`).then(setCard, onError);
              } else closeDialog(dialog);
            }}
            onCancel={() => setMoving(false)}
          />
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-stone-100 pt-4">
          {!moving && (
            <button type="button" className={secondaryButton} onClick={() => setMoving(true)}>
              <ArrowRightLeft className="h-4 w-4" aria-hidden /> Move…
            </button>
          )}
          {!confirmDelete && (
            <button type="button" className={dangerButton} onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" aria-hidden /> Delete…
            </button>
          )}
          <span className="flex-1" />
          <span className="text-xs text-stone-400 tabular-nums" title="Made">
            {card.createdAt.slice(0, 10)}
          </span>
        </div>

        {confirmDelete && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <p>Delete this card? This can't be undone.</p>
            <div className="mt-3 flex gap-2">
              <button type="button" className={dangerButton} onClick={() => void props.onDelete()}>
                Delete the card
              </button>
              <button type="button" className={secondaryButton} onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function TitleField({ title, onSave }: { title: string; onSave: (title: string) => void }) {
  const [text, setText] = useState(title);
  useEffect(() => setText(title), [title]);
  const save = () => {
    const t = text.replace(/\s+/g, " ").trim();
    if (t && t !== title) onSave(t);
    else setText(title);
  };
  return (
    <textarea
      aria-label="Title"
      rows={1}
      value={text}
      maxLength={LIMITS.titleChars}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      className="field-sizing-content block w-full resize-none rounded-md border border-transparent px-2 py-1 text-lg
        font-semibold text-stone-800 hover:border-stone-200 focus:border-violet-400 focus:outline-none"
    />
  );
}

function DescriptionField({ text, onSave }: { text: string; onSave: (text: string) => void }) {
  const [value, setValue] = useState(text);
  useEffect(() => setValue(text), [text]);
  return (
    <textarea
      aria-label="Description"
      placeholder="Notes, links, details…"
      value={value}
      maxLength={LIMITS.descriptionChars}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => value.trimEnd() !== text && onSave(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      className={`${field} field-sizing-content block min-h-24 w-full resize-y`}
    />
  );
}

/** Moving the card to another list or board, at a chosen position. For phones, and for other boards. */
function MoveSection(props: {
  card: Card;
  board: BoardData;
  boards: Board[];
  onError: (err: unknown) => void;
  onMoved: (boardId: string, text: string, dialog: Element) => void;
  onCancel: () => void;
}) {
  const { card, board, onError } = props;
  const here = board.board.id;
  const [boardId, setBoardId] = useState(here);
  // Another board, fetched when picked.
  const [elsewhere, setElsewhere] = useState<BoardData | null>(null);
  const [listId, setListId] = useState(card.listId);
  const [position, setPosition] = useState(() => cardsIn(board, card.listId).findIndex((c) => c.id === card.id));
  const [busy, setBusy] = useState(false);
  const target = boardId === here ? board : elsewhere?.board.id === boardId ? elsewhere : null;

  useEffect(() => {
    if (boardId === here || !boardId) return;
    let stale = false;
    api<BoardData>(`/api/boards/${boardId}`).then(
      (d) => {
        if (stale) return;
        setElsewhere(d);
        setListId(d.lists[0]?.id ?? "");
        setPosition(0);
      },
      (err: unknown) => !stale && onError(err),
    );
    return () => {
      stale = true;
    };
  }, [boardId, here, onError]);

  const others = target ? cardsIn(target, listId).filter((c) => c.id !== card.id) : [];

  return (
    <section className="space-y-3 rounded-lg bg-stone-50 p-3">
      <h3 className="text-sm font-semibold text-stone-700">Move the card</h3>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-xs text-stone-500">
          Board
          <select
            className={`${field} mt-1 w-full`}
            value={boardId}
            onChange={(e) => {
              setBoardId(e.target.value);
              if (e.target.value === board.board.id) {
                setListId(card.listId);
                setPosition(0);
              }
            }}
          >
            {props.boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-stone-500">
          List
          <select
            className={`${field} mt-1 w-full`}
            value={listId}
            disabled={!target}
            onChange={(e) => {
              setListId(e.target.value);
              setPosition(0);
            }}
          >
            {target?.lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-stone-500">
          Position
          <select
            className={`${field} mt-1 w-full`}
            value={position}
            disabled={!target}
            onChange={(e) => setPosition(Number(e.target.value))}
          >
            {Array.from({ length: others.length + 1 }, (_, i) => (
              <option key={i} value={i}>
                {i === 0 ? "1 (top)" : i === others.length ? `${i + 1} (bottom)` : i + 1}
              </option>
            ))}
          </select>
        </label>
      </div>
      {target && target.lists.length === 0 && <p className="text-xs text-red-700">That board has no lists.</p>}
      <div className="flex gap-2">
        <button
          type="button"
          className={primaryButton}
          disabled={busy || !target || !listId}
          onClick={async (e) => {
            const button = e.currentTarget;
            setBusy(true);
            try {
              const afterId = position === 0 ? null : others[position - 1]!.id;
              const moved = await api<CardMoved>(`/api/cards/${card.id}/move`, {
                method: "POST",
                body: { listId, afterId },
              });
              const listName = target!.lists.find((l) => l.id === listId)?.name ?? "";
              const where = boardId === board.board.id ? listName : `${target!.board.name} · ${listName}`;
              const dropped = moved.droppedLabels
                ? `, without ${count(moved.droppedLabels, "label", "labels")} that board doesn't have`
                : "";
              props.onMoved(boardId, `${card.title} is in ${where}${dropped}.`, button);
            } catch (err) {
              props.onError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          Move
        </button>
        <button type="button" className={secondaryButton} onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}
