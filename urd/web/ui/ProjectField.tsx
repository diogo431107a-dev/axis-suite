import { useId, useMemo, useRef, useState } from "react";
import { LIMITS, type Project } from "../../shared/protocol.ts";
import { textInput } from "./buttons.ts";

interface ProjectFieldProps {
  /** the project's name, "" for none */
  value: string;
  projects: Project[];
  /** a different name was typed (on Enter, leaving the field, or picking a suggestion) */
  onCommit: (name: string) => void;
  /** every keystroke, for a form that saves the name with its own button */
  onText?: (text: string) => void;
  id?: string;
  placeholder?: string;
}

/** A project's name, with the projects in use as suggestions (the latest used first). A new name makes a project. */
export function ProjectField({
  value,
  projects,
  onCommit,
  onText,
  id,
  placeholder = "No project yet",
}: ProjectFieldProps) {
  const [text, setText] = useState(value);
  const [source, setSource] = useState(value);
  // A new value from outside (another device, a new session) replaces what is shown.
  if (value !== source) {
    setSource(value);
    setText(value);
  }
  const skip = useRef(false);
  const listId = useId();
  const names = useMemo(
    () =>
      projects
        .filter((p) => !p.archived)
        .sort((a, b) => (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? "") || a.name.localeCompare(b.name))
        .map((p) => p.name),
    [projects],
  );

  const commit = (name: string) => {
    if (name.trim() !== value.trim()) onCommit(name.trim());
  };

  return (
    <>
      <input
        id={id}
        list={listId}
        value={text}
        maxLength={LIMITS.projectNameChars}
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
        {names.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </>
  );
}
