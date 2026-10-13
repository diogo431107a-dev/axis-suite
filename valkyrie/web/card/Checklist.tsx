import { useEffect, useRef, useState } from "react";
import { GripVertical, Plus, X } from "lucide-react";
import { LIMITS, type ChecklistItem } from "../../shared/protocol.ts";
import { startSort } from "../board/dnd.ts";
import { iconButton } from "../ui/buttons.ts";

interface ChecklistProps {
  items: ChecklistItem[];
  onAdd: (text: string) => Promise<boolean>;
  onChange: (item: ChecklistItem, change: { text?: string; done?: boolean }) => void;
  onDelete: (item: ChecklistItem) => void;
  /** to an index among the other items */
  onMove: (item: ChecklistItem, index: number) => void;
}

/** A card's checklist: tick, edit, delete and reorder (drag the grip, or Ctrl+Shift+↑/↓). */
export function Checklist({ items, onAdd, onChange, onDelete, onMove }: ChecklistProps) {
  const list = useRef<HTMLUListElement>(null);
  const done = items.filter((i) => i.done).length;
  const rows = () => [...(list.current?.querySelectorAll<HTMLElement>("[data-item]") ?? [])];

  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-stone-500 tabular-nums">
          <span>
            {done}/{items.length}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-200" aria-hidden>
            <div
              className={`h-full rounded-full ${done === items.length ? "bg-green-500" : "bg-violet-500"}`}
              style={{ width: `${(done / items.length) * 100}%` }}
            />
          </div>
        </div>
      )}
      <ul ref={list} className="space-y-0.5">
        {items.map((item, i) => (
          <li key={item.id} data-item className="group flex items-center gap-1 rounded-md pr-1 hover:bg-stone-50">
            <span
              className="cursor-grab touch-none p-1 text-stone-300 hover:text-stone-500"
              title="Drag to reorder"
              aria-hidden
              onPointerDown={(e) => startSort(e, e.currentTarget.closest("li")!, rows, (index) => onMove(item, index))}
            >
              <GripVertical className="h-4 w-4" />
            </span>
            <input
              type="checkbox"
              checked={item.done}
              aria-label={`Done: ${item.text}`}
              onChange={(e) => onChange(item, { done: e.target.checked })}
              className="h-4 w-4 shrink-0 accent-violet-600"
            />
            <ItemText
              item={item}
              onSave={(text) => onChange(item, { text })}
              onMove={(step) => {
                const to = i + step;
                if (to >= 0 && to < items.length) onMove(item, to);
              }}
            />
            <button
              type="button"
              className={`${iconButton} opacity-0 group-hover:opacity-100 focus:opacity-100 max-md:opacity-100`}
              aria-label={`Delete ${item.text}`}
              onClick={() => onDelete(item)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      {items.length < LIMITS.items && <NewItem onAdd={onAdd} />}
    </div>
  );
}

function ItemText({
  item,
  onSave,
  onMove,
}: {
  item: ChecklistItem;
  onSave: (text: string) => void;
  onMove: (step: -1 | 1) => void;
}) {
  const [text, setText] = useState(item.text);
  useEffect(() => setText(item.text), [item.text]);
  const save = () => {
    const t = text.trim();
    if (t && t !== item.text) onSave(t);
    else setText(item.text);
  };
  return (
    <input
      aria-label="Checklist item"
      value={text}
      maxLength={LIMITS.itemChars}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          save();
        } else if (e.key === "Escape" && text !== item.text) {
          e.preventDefault();
          e.stopPropagation();
          setText(item.text);
        } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          e.preventDefault();
          save();
          onMove(e.key === "ArrowUp" ? -1 : 1);
          // The item's row is redrawn elsewhere; keep typing in it.
          const field = e.currentTarget;
          requestAnimationFrame(() => field.focus());
        }
      }}
      className={`min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-stone-200
        focus:border-violet-400 focus:bg-white focus:outline-none ${item.done ? "text-stone-400 line-through" : "text-stone-700"}`}
    />
  );
}

function NewItem({ onAdd }: { onAdd: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!text.trim() || busy) return;
    setBusy(true);
    if (await onAdd(text.trim())) setText("");
    setBusy(false);
  }
  return (
    <div className="flex items-center gap-1 pl-6">
      <Plus className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
      <input
        aria-label="New checklist item"
        placeholder="Add an item…"
        value={text}
        maxLength={LIMITS.itemChars}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
        className="min-w-0 flex-1 rounded border border-transparent px-1.5 py-1 text-sm placeholder-stone-400
          hover:border-stone-200 focus:border-violet-400 focus:outline-none"
      />
    </div>
  );
}
