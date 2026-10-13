import { useEffect, useState } from "react";
import { field } from "../ui/buttons.ts";
import { parseTimeInput } from "./parse.ts";

interface TimeFieldProps {
  id?: string;
  value: string;
  onChange: (time: string) => void;
  label: string;
}

/**
 * A time as HH:MM on a 24-hour clock (1400, 14 and 14:00 all work). Not <input type="time">,
 * which shows AM/PM in some browsers' languages.
 */
export function TimeField({ id, value, onChange, label }: TimeFieldProps) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const bad = parseTimeInput(text) === null;
  return (
    <input
      id={id}
      aria-label={label}
      aria-invalid={bad}
      inputMode="numeric"
      placeholder="HH:MM"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        // Taken at once only when complete; anything else on leaving the field.
        if (/^\d{2}:\d{2}$/.test(e.target.value.trim())) {
          const time = parseTimeInput(e.target.value);
          if (time) onChange(time);
        }
      }}
      onBlur={() => {
        const time = parseTimeInput(text);
        if (time) onChange(time);
        setText(time ?? value);
      }}
      className={`${field} w-20 tabular-nums ${bad ? "border-red-300" : ""}`}
    />
  );
}
