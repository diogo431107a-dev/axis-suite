import { useId, useRef, useState } from "react";
import { textInput } from "./buttons.ts";

export interface NameFieldProps {
  /** the name, "" for none */
  value: string;
  /** a different name was typed (on Enter, leaving the field, or picking a suggestion) */
  onCommit: (name: string) => void;
  /** every keystroke, for a form that saves the name with its own button */
  onText?: (text: string) => void;
  id?: string;
  placeholder?: string;
}

/** A name, with suggestions. Esc puts back what it was. Used for projects and tasks. */
export function NameField({
  value,
  suggestions,
  maxLength,
  onCommit,
  onText,
  id,
  placeholder,
}: NameFieldProps & { suggestions: string[]; maxLength: number }) {
  const [text, setText] = useState(value);
  const [source, setSource] = useState(value);
  // A new value from outside (another device, a new session) replaces what is shown.
  if (value !== source) {
    setSource(value);
    setText(value);
  }
  const skip = useRef(false);
  const listId = useId();

  const commit = (name: string) => {
    if (name.trim() !== value.trim()) onCommit(name.trim());
  };

  return (
    <>
      <input
        id={id}
        list={listId}
        value={text}
        maxLength={maxLength}
        autoComplete="off"
        placeholder={placeholder}
        className={textInput}
        onChange={(e) => {
          setText(e.target.value);
          onText?.(e.target.value);
          // Picked from the suggestions: no typing comes after it.
          if ((e.nativeEvent as InputEvent).inputType === "insertReplacementText") commit(e.target.value);
        }}
        onBlur={() => {
          if (skip.current) skip.current = false;
          else commit(text);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape" && text !== value) {
            e.preventDefault();
            skip.current = true;
            setText(value);
            e.currentTarget.blur();
          }
        }}
      />
      <datalist id={listId}>
        {suggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </>
  );
}
