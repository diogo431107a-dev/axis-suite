// A bullet's text as shown when it isn't being edited, built from tokens as React elements
// (never innerHTML). Every piece of text sits in an element with data-offset, where it starts in
// the source, so a click can put the caret on the character that was clicked; chips that show
// something else (a date as "Today") have data-end instead.
import { memo, useMemo, useRef, type ReactNode } from "react";
import type { Field } from "../model/ui.ts";
import { useOutliner } from "../outline/hooks.ts";
import { dateLabel, localDate } from "./dates.ts";
import { tokenize, type Token } from "./inline.ts";

interface Props {
  text: string;
  /** Search words to mark. */
  highlight?: RegExp | null;
  /** The bullet and field the text belongs to, so date chips can change it. */
  id?: string;
  field?: Field;
}

export const Inline = memo(function Inline({ text, highlight = null, id, field = "content" }: Props) {
  const tokens = useMemo(() => tokenize(text), [text]);
  const ctx: RenderCtx = { highlight, id, field, text };
  return <>{render(tokens, ctx)}</>;
});

interface RenderCtx {
  highlight: RegExp | null;
  id?: string;
  field: Field;
  text: string;
}

const linkClass = "text-sky-700 underline decoration-sky-300 underline-offset-2 hover:decoration-sky-700";

/** Plain text, with search matches marked. Each piece keeps its own source offset. */
function plain(text: string, start: number, highlight: RegExp | null): ReactNode {
  if (!highlight) return <span data-offset={start}>{text}</span>;
  const parts = text.split(highlight);
  if (parts.length === 1) return <span data-offset={start}>{text}</span>;
  let offset = start;
  return parts.map((part, i) => {
    const at = offset;
    offset += part.length;
    if (!part) return null;
    // split() with a capturing group puts the matches at odd indexes.
    return i % 2 === 1 ? (
      <mark key={at} data-offset={at} className="rounded-sm bg-yellow-200 text-inherit">
        {part}
      </mark>
    ) : (
      <span key={at} data-offset={at}>
        {part}
      </span>
    );
  });
}

function render(tokens: Token[], ctx: RenderCtx): ReactNode[] {
  return tokens.map((t) => {
    switch (t.type) {
      case "text":
        return <span key={t.start}>{plain(t.text, t.start, ctx.highlight)}</span>;
      case "bold":
        return (
          <strong key={t.start} className="font-semibold">
            {render(t.children, ctx)}
          </strong>
        );
      case "italic":
        return <em key={t.start}>{render(t.children, ctx)}</em>;
      case "strike":
        return (
          <s key={t.start} className="text-gray-400">
            {render(t.children, ctx)}
          </s>
        );
      case "code":
        return (
          <code key={t.start} className="rounded bg-gray-100 px-1 font-mono text-[0.88em]">
            <span data-offset={t.textStart}>{t.text}</span>
          </code>
        );
      case "link":
        return (
          <a key={t.start} href={t.url} target="_blank" rel="noopener noreferrer" className={linkClass}>
            <span data-offset={t.textStart}>{t.text}</span>
          </a>
        );
      case "url":
        return (
          <a key={t.start} href={t.url} target="_blank" rel="noopener noreferrer" className={linkClass}>
            <span data-offset={t.start}>{t.url}</span>
          </a>
        );
      case "tag":
      case "mention":
        return (
          <span
            key={t.start}
            data-tag={t.text}
            data-offset={t.start}
            title={`Search for ${t.text}`}
            className={`cursor-pointer hover:underline ${t.type === "tag" ? "text-sky-700" : "text-violet-700"}`}
          >
            {t.text}
          </span>
        );
      case "date":
        return <DateChip key={t.start} token={t} ctx={ctx} />;
    }
  });
}

/** A date as a chip. A click opens the browser's date picker, and the choice goes into the text. */
function DateChip({ token, ctx }: { token: Extract<Token, { type: "date" }>; ctx: RenderCtx }) {
  const o = useOutliner();
  const input = useRef<HTMLInputElement>(null);
  const today = localDate();
  const overdue = token.date < today;
  const look = overdue
    ? "bg-red-50 text-red-700"
    : token.date === today
      ? "bg-green-50 text-green-800"
      : "bg-gray-100 text-gray-700";
  const choose = (date: string) => {
    if (!ctx.id || !date || date === token.date) return;
    const source = ctx.text;
    const next = `${source.slice(0, token.start)}!(${date}${token.time ? ` ${token.time}` : ""})${source.slice(token.end)}`;
    o.commit({
      ops: [
        ctx.field === "content"
          ? { op: "update", id: ctx.id, content: next }
          : { op: "update", id: ctx.id, note: next },
      ],
    });
  };
  return (
    <span
      data-end={token.end}
      title={token.date}
      onClick={(e) => {
        if (!ctx.id) return;
        e.stopPropagation();
        const el = input.current;
        if (el && "showPicker" in el) el.showPicker();
      }}
      className={`relative cursor-pointer rounded px-1 text-[0.9em] ${look}`}
    >
      {dateLabel(token.date, today)}
      {token.time ? ` ${token.time}` : ""}
      {ctx.id && (
        <input
          ref={input}
          type="date"
          tabIndex={-1}
          aria-label="Change the date"
          defaultValue={token.date}
          onChange={(e) => choose(e.currentTarget.value)}
          className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        />
      )}
    </span>
  );
}
