import { useId, useState } from "react";
import { X } from "lucide-react";
import { LIMITS } from "../../shared/protocol.ts";

interface TagsFieldProps {
  tags: string[];
  /** tags used before, the most used first */
  suggestions: string[];
  onChange: (tags: string[]) => void;
  id?: string;
}

/** A tag as the server keeps it: lower case, without #. */
const normalize = (text: string) => text.trim().replace(/^#+/, "").replace(/\s+/g, " ").toLowerCase();

/** Tags as chips. Enter or a comma adds what was typed; Backspace in the empty field takes the last one off. */
export function TagsField({ tags, suggestions, onChange, id }: TagsFieldProps) {
  const [text, setText] = useState("");
  const listId = useId();
  const full = tags.length >= LIMITS.tagsPerSession;

  const add = (value: string) => {
    const tag = normalize(value);
    setText("");
    if (tag && !tags.includes(tag) && !full) onChange([...tags, tag]);
  };

  return (
    <div
      className="flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5
                 focus-within:border-transparent focus-within:ring-2 focus-within:ring-sky-400"
    >
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-md bg-zinc-100 dark:bg-zinc-800 py-0.5 pr-1 pl-2 text-sm text-zinc-700 dark:text-zinc-300"
        >
          #{tag}
          <button
            type="button"
            className="rounded text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-100"
            aria-label={`Remove the tag ${tag}`}
            onClick={() => onChange(tags.filter((t) => t !== tag))}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
      <input
        id={id}
        list={listId}
        value={text}
        disabled={full}
        maxLength={LIMITS.tagChars + 1}
        autoComplete="off"
        placeholder={tags.length ? "" : "Tags (optional)"}
        className="min-w-24 flex-1 bg-transparent px-1 py-0.5 text-sm text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none"
        onChange={(e) => {
          const value = e.target.value;
          if (value.endsWith(",") || (e.nativeEvent as InputEvent).inputType === "insertReplacementText")
            add(value.replace(/,$/, ""));
          else setText(value);
        }}
        onBlur={() => text && add(text)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(text);
          } else if (e.key === "Backspace" && text === "" && tags.length > 0) {
            onChange(tags.slice(0, -1));
          }
        }}
      />
      <datalist id={listId}>
        {suggestions
          .filter((s) => !tags.includes(s))
          .slice(0, 50)
          .map((s) => (
            <option key={s} value={s} />
          ))}
      </datalist>
    </div>
  );
}
