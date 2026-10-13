import { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { monthOf } from "../../shared/dates.ts";
import { field, iconButton } from "../ui/buttons.ts";
import { MiniMonth } from "./MiniMonth.tsx";
import { parseDateInput } from "./parse.ts";

interface DateFieldProps {
  id?: string;
  value: string;
  onChange: (date: string) => void;
  today: string;
  label: string;
}

/**
 * A date as YYYY-MM-DD: typed (20261013 and 2026-10-13 both work), or picked from a small month.
 * Not <input type="date">, which shows dates the way the browser's language writes them.
 */
export function DateField({ id, value, onChange, today, label }: DateFieldProps) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(monthOf(value));
  const box = useRef<HTMLDivElement>(null);
  const bad = parseDateInput(text) === null;

  useEffect(() => setText(value), [value]);

  // A click anywhere else closes the picker.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={box} className="relative flex items-center gap-1">
      <input
        id={id}
        aria-label={label}
        aria-invalid={bad}
        inputMode="numeric"
        placeholder="YYYY-MM-DD"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          // Taken at once only when complete; anything else on leaving the field.
          if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value.trim())) {
            const date = parseDateInput(e.target.value);
            if (date) onChange(date);
          }
        }}
        onBlur={() => {
          const date = parseDateInput(text);
          if (date) onChange(date);
          setText(date ?? value);
        }}
        className={`${field} w-32 tabular-nums ${bad ? "border-red-300" : ""}`}
      />
      <button
        type="button"
        className={iconButton}
        aria-label={`Pick the ${label.toLowerCase()}`}
        aria-expanded={open}
        onClick={() => {
          setMonth(monthOf(parseDateInput(text) ?? value));
          setOpen((o) => !o);
        }}
      >
        <CalendarDays className="h-4 w-4" />
      </button>
      {open && (
        <div
          className="absolute top-full left-0 z-20 mt-1 w-60 rounded-lg border border-stone-200 bg-white p-2 shadow-lg"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              e.preventDefault();
              setOpen(false);
            }
          }}
        >
          <MiniMonth
            month={month}
            onMonth={setMonth}
            today={today}
            selected={value}
            onPick={(date) => {
              onChange(date);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
