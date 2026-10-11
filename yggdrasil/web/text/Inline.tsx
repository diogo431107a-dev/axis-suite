// A bullet's text as shown when it isn't being edited, built from tokens as React elements
// (never innerHTML). Every piece of text sits in an element with data-offset, where it starts in
// the source, so a click can put the caret on the character that was clicked; chips that show
// something else (a date as "Today") have data-end instead.
import { memo, useMemo, type ReactNode } from "react";
import { tokenize, type Token } from "./inline.ts";

interface Props {
  text: string;
}

export const Inline = memo(function Inline({ text }: Props) {
  const tokens = useMemo(() => tokenize(text), [text]);
  return <>{render(tokens)}</>;
});

const linkClass = "text-sky-700 underline decoration-sky-300 underline-offset-2 hover:decoration-sky-700";

function render(tokens: Token[]): ReactNode[] {
  return tokens.map((t) => {
    switch (t.type) {
      case "text":
        return (
          <span key={t.start} data-offset={t.start}>
            {t.text}
          </span>
        );
      case "bold":
        return (
          <strong key={t.start} className="font-semibold">
            {render(t.children)}
          </strong>
        );
      case "italic":
        return <em key={t.start}>{render(t.children)}</em>;
      case "strike":
        return (
          <s key={t.start} className="text-gray-400">
            {render(t.children)}
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
        return (
          <span
            key={t.start}
            data-tag={t.name}
            data-offset={t.start}
            title={`Search for ${t.text}`}
            className="cursor-pointer text-sky-700 hover:underline"
          >
            {t.text}
          </span>
        );
      case "mention":
        return (
          <span
            key={t.start}
            data-tag={t.text}
            data-offset={t.start}
            title={`Search for ${t.text}`}
            className="cursor-pointer text-violet-700 hover:underline"
          >
            {t.text}
          </span>
        );
      case "date":
        return (
          <span key={t.start} data-end={t.end} className="rounded bg-gray-100 px-1 text-[0.9em] text-gray-700">
            {t.date}
            {t.time ? ` ${t.time}` : ""}
          </span>
        );
    }
  });
}
