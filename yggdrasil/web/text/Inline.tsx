// A bullet's text as shown when it isn't being edited, built from tokens as React elements
// (never innerHTML). Every piece of text sits in an element with data-offset, where it starts in
// the source, so a click can put the caret on the character that was clicked; chips that show
// something else (a date as "Today") have data-end instead.
import { memo, useMemo, useRef, useState, type ReactNode } from "react";
import { Paperclip } from "lucide-react";
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
      case "image":
        return <FileImage key={t.start} token={t} />;
      case "file":
        return (
          <a
            key={t.start}
            href={t.url}
            download={t.name}
            data-end={t.end}
            title={`Download ${t.name}`}
            className="inline-flex max-w-full items-center gap-1 rounded bg-gray-100 px-1.5 align-baseline text-[0.9em] text-gray-700 hover:bg-gray-200"
          >
            <Paperclip aria-hidden className="h-3.5 w-3.5 shrink-0 text-gray-500" />
            <span className="truncate">{t.name}</span>
          </a>
        );
    }
  });
}

/**
 * An uploaded image: its preview, which opens the original in a new tab. One the user may not
 * see (or that is gone) says so instead.
 */
function FileImage({ token }: { token: Extract<Token, { type: "image" }> }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span data-end={token.end} className="rounded bg-gray-100 px-1 text-[0.9em] text-gray-500">
        {token.alt || "Image"} (not available)
      </span>
    );
  }
  return (
    <a
      href={token.url}
      target="_blank"
      rel="noopener"
      data-end={token.end}
      className="my-1 inline-block max-w-full align-top"
    >
      <img
        src={`${token.url}/preview`}
        alt={token.alt}
        title={token.alt}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="max-h-80 max-w-full rounded border border-gray-100"
      />
    </a>
  );
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
