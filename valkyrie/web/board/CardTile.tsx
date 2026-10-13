import type { PointerEvent as ReactPointerEvent } from "react";
import { AlignLeft, CalendarClock, CheckSquare } from "lucide-react";
import type { CardSummary, Label } from "../../shared/protocol.ts";
import { COLOR_CLASSES } from "../colors.ts";

interface CardTileProps {
  card: CardSummary;
  labels: ReadonlyMap<string, Label>;
  today: string;
  /** the board's one tab stop is on this card */
  tabStop: boolean;
  /** picked up with Space */
  held: boolean;
  /** being dragged with the pointer: it keeps its place in the page, but takes no room */
  dragging: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onOpen: () => void;
  onFocus: () => void;
  onBlur: () => void;
}

/** "Due 2026-10-20" in red when overdue, amber today. */
function dueClass(due: string, today: string): string {
  if (due < today) return "bg-red-100 text-red-800";
  if (due === today) return "bg-amber-100 text-amber-900";
  return "text-stone-500";
}

/** A card as the board shows it: labels, title, and badges for the due date, checklist and notes. */
export function CardTile(props: CardTileProps) {
  const { card, labels, today, held, dragging } = props;
  const cardLabels = card.labelIds.map((id) => labels.get(id)).filter((l): l is Label => !!l);
  const { done, total } = card.checklist;
  const due = card.dueDate;

  return (
    <div
      data-card={card.id}
      data-focus={`card:${card.id}`}
      data-dragging={dragging || undefined}
      role="button"
      tabIndex={props.tabStop ? 0 : -1}
      aria-roledescription="card"
      aria-pressed={held || undefined}
      aria-label={[
        card.title,
        ...cardLabels.map((l) => `label ${l.name || l.color}`),
        due && `due ${due}${due < today ? ", overdue" : due === today ? ", today" : ""}`,
        total > 0 && `checklist ${done} of ${total}`,
        card.hasDescription && "has a description",
      ]
        .filter(Boolean)
        .join(", ")}
      onPointerDown={props.onPointerDown}
      // Keyboard and screen-reader clicks; a mouse's is handled by the drag code (it may be a drag).
      onClick={(e) => e.detail === 0 && props.onOpen()}
      onFocus={props.onFocus}
      onBlur={props.onBlur}
      style={dragging ? { height: 0, minHeight: 0, padding: 0, margin: "-8px 0 0", border: 0, opacity: 0 } : undefined}
      className={`group cursor-pointer overflow-hidden rounded-lg border bg-white px-3 py-2 text-sm shadow-sm
        transition-shadow select-none [-webkit-touch-callout:none] hover:border-stone-300 focus:outline-none
        focus-visible:ring-2 focus-visible:ring-violet-500 ${
          held ? "rotate-1 border-violet-400 shadow-lg ring-2 ring-violet-500" : "border-stone-200"
        }`}
    >
      {cardLabels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1" aria-hidden>
          {cardLabels.map((l) =>
            l.name ? (
              <span
                key={l.id}
                className={`rounded px-1.5 py-px text-[11px] font-medium ${COLOR_CLASSES[l.color].chip}`}
              >
                {l.name}
              </span>
            ) : (
              <span key={l.id} className={`h-2 w-8 rounded-full ${COLOR_CLASSES[l.color].dot}`} />
            ),
          )}
        </div>
      )}
      <p className="break-words whitespace-pre-wrap text-stone-800">{card.title}</p>
      {(due || total > 0 || card.hasDescription) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-stone-500" aria-hidden>
          {due && (
            <span className={`inline-flex items-center gap-1 rounded px-1 tabular-nums ${dueClass(due, today)}`}>
              <CalendarClock className="h-3.5 w-3.5" /> {due}
            </span>
          )}
          {total > 0 && (
            <span
              className={`inline-flex items-center gap-1 rounded px-1 tabular-nums ${
                done === total ? "bg-green-100 text-green-800" : ""
              }`}
            >
              <CheckSquare className="h-3.5 w-3.5" /> {done}/{total}
            </span>
          )}
          {card.hasDescription && <AlignLeft className="h-3.5 w-3.5" />}
        </div>
      )}
    </div>
  );
}
