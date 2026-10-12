import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, isDate } from "../../shared/dates.ts";
import type { Journal, Template } from "../../shared/protocol.ts";
import { tagsOf } from "../../shared/tags.ts";
import { countWords } from "../../shared/words.ts";
import { JOURNAL_COLORS } from "../colors.ts";
import { longDate, nearDay, savedAt } from "../format.ts";
import { go } from "../nav.ts";
import { pageKey, type DayState, type PageSync } from "../pages/sync.ts";
import { iconButton, secondaryButton } from "../ui/buttons.ts";
import { MoodPicker } from "./MoodPicker.tsx";
import { OnThisDay } from "./OnThisDay.tsx";
import { PromptCard } from "./PromptCard.tsx";

interface DayViewProps {
  sync: PageSync;
  journal: Journal;
  journals: Journal[];
  date: string;
  today: string;
  templates: Template[];
  prompts: readonly string[];
  revision: number;
  onError: (err: unknown) => void;
}

/** One journal's page for one day: the date, the mood, the text, and earlier years' pages. */
export function DayView({ sync, journal, journals, date, today, templates, prompts, revision, onError }: DayViewProps) {
  const key = pageKey(journal.id, date);
  const editor = useRef<HTMLTextAreaElement>(null);
  const datePicker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const opened = sync.open(journal.id, date);
    return () => sync.close(opened);
  }, [sync, journal.id, date]);

  const state = useSyncExternalStore(sync.subscribe, () => sync.day(key));
  const text = state?.text ?? "";
  const loaded = state?.loaded ?? false;

  // The textarea grows with the text, so the page scrolls as one.
  useLayoutEffect(() => {
    const el = editor.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text, loaded]);

  // On a wide screen the caret waits in the text, at its end. (On a phone it would open the keyboard.)
  useEffect(() => {
    if (!loaded || !window.matchMedia("(min-width: 768px)").matches) return;
    const el = editor.current;
    if (!el || document.activeElement?.closest("dialog, input, textarea, select")) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [loaded, key]);

  const words = useMemo(() => countWords(text), [text]);
  const tags = useMemo(() => tagsOf(text), [text]);
  const near = nearDay(date, today);
  const own = templates.filter((t) => t.id === journal.templateId);
  const offered = [...own, ...templates.filter((t) => t.id !== journal.templateId)];

  // A prompt or template, into a page that is still empty.
  const insert = (start: string, caret = start.length) => {
    sync.edit(key, { text: start });
    requestAnimationFrame(() => {
      const el = editor.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  const goTo = (day: string) => go({ kind: "day", journalId: journal.id, date: day });

  return (
    <article className="mx-auto w-full max-w-3xl px-4 pt-6 pb-24 sm:px-8 sm:pt-10">
      <header className="mb-5">
        <div className="mb-1 flex items-center gap-1">
          <span className="flex min-w-0 flex-1 items-center gap-2 text-xs text-stone-500">
            <span className={`h-2 w-2 shrink-0 rounded-full ${JOURNAL_COLORS[journal.color].dot}`} aria-hidden />
            <span className="truncate">{journal.name}</span>
          </span>
          {date !== today && (
            <button
              type="button"
              onClick={() => goTo(today)}
              title="Today (T)"
              className="mr-1 rounded-md border border-stone-200 bg-white px-2.5 py-1 text-xs text-stone-700 hover:border-stone-300 hover:bg-stone-50"
            >
              Today
            </button>
          )}
          <button
            type="button"
            className={iconButton}
            aria-label="Previous day (←)"
            title="Previous day (←)"
            onClick={() => goTo(addDays(date, -1))}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            className={iconButton}
            aria-label="Next day (→)"
            title="Next day (→)"
            onClick={() => goTo(addDays(date, 1))}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <div className="relative">
            <button
              type="button"
              className={iconButton}
              aria-label="Choose a day"
              title="Choose a day"
              onClick={() => datePicker.current?.showPicker?.()}
            >
              <CalendarDays className="h-5 w-5" />
            </button>
            <input
              ref={datePicker}
              type="date"
              value={date}
              onChange={(e) => isDate(e.target.value) && goTo(e.target.value)}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
            />
          </div>
        </div>
        <h1 className="font-serif text-2xl text-stone-900 sm:text-3xl">
          {longDate(date)}
          {near && <span className="ml-3 align-middle text-sm font-normal text-amber-700">{near}</span>}
        </h1>
      </header>

      <div className="mb-5">
        <MoodPicker mood={state?.mood ?? null} disabled={!loaded} onChange={(mood) => sync.edit(key, { mood })} />
      </div>

      {state?.theirs && <ConflictBanner state={state} onResolve={(choice) => sync.resolve(key, choice)} />}
      {state?.problem && (
        <p
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          This page can't be saved: {state.problem} Your text is kept in this browser.
        </p>
      )}

      {loaded && text.trim() === "" && (
        <PromptCard key={date} date={date} prompts={prompts} templates={offered} onInsert={insert} />
      )}

      <textarea
        ref={editor}
        value={text}
        readOnly={!loaded}
        onChange={(e) => sync.edit(key, { text: e.target.value })}
        onBlur={() => sync.flush(key)}
        placeholder={loaded ? "Write about your day…" : "Opening…"}
        aria-label={`Page for ${longDate(date)}`}
        rows={12}
        spellCheck
        className="block min-h-[50vh] w-full resize-none overflow-hidden border-0 bg-transparent p-0 font-serif text-lg
          leading-relaxed text-stone-800 placeholder-stone-300 focus:ring-0 focus:outline-none"
      />

      <footer className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-stone-200 pt-3 text-xs text-stone-500">
        <span>{words === 1 ? "1 word" : `${words} words`}</span>
        {tags.length > 0 && (
          <span className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => go({ kind: "search", q: `#${tag}`, journalId: null })}
                className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-600 hover:bg-amber-100 hover:text-amber-900"
              >
                #{tag}
              </button>
            ))}
          </span>
        )}
        <span className="ml-auto">
          <PageStatus state={state} />
        </span>
      </footer>

      <OnThisDay date={date} journals={journals} revision={revision} onError={onError} />
    </article>
  );
}

function PageStatus({ state }: { state: DayState | undefined }) {
  if (!state?.loaded) return null;
  if (state.theirs || state.problem) return <span className="text-amber-700">Not saved yet</span>;
  if (state.saving || state.dirty) return <>Saving…</>;
  if (state.updatedAt) return <>Saved {savedAt(state.updatedAt)}</>;
  return null;
}

interface ConflictBannerProps {
  state: DayState;
  onResolve: (choice: "mine" | "theirs" | "both") => void;
}

/** The page was saved somewhere else while it was being written here. */
function ConflictBanner({ state, onResolve }: ConflictBannerProps) {
  return (
    <div role="alert" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        This page was changed in another tab or on another device while you were writing. Your text is safe; choose what
        to keep.
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-amber-800">See the other version</summary>
        <p className="mt-2 max-h-48 overflow-y-auto rounded border border-amber-200 bg-white p-3 font-serif whitespace-pre-wrap text-stone-700">
          {state.theirs?.text || <em className="text-stone-400">Empty</em>}
        </p>
      </details>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={secondaryButton} onClick={() => onResolve("mine")}>
          Keep mine
        </button>
        <button type="button" className={secondaryButton} onClick={() => onResolve("theirs")}>
          Use the other version
        </button>
        <button type="button" className={secondaryButton} onClick={() => onResolve("both")}>
          Keep both
        </button>
      </div>
    </div>
  );
}
