import { useEffect, useState, type ReactNode } from "react";
import type { Journal, SearchAnswer, SearchHit } from "../../shared/protocol.ts";
import { api, query } from "../api.ts";
import { JOURNAL_COLORS, MOOD_COLORS } from "../colors.ts";
import { longDate } from "../format.ts";
import { go } from "../nav.ts";
import { JournalFilter } from "../ui/JournalFilter.tsx";
import { Link } from "../ui/Link.tsx";

interface SearchViewProps {
  journals: Journal[];
  q: string;
  journalId: string | null;
  revision: number;
  onError: (err: unknown) => void;
}

/** The pages a search finds (the box is in the sidebar), newest first. */
export function SearchView({ journals, q, journalId, revision, onError }: SearchViewProps) {
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);

  useEffect(() => {
    if (!q.trim()) return setAnswer(null);
    let stale = false;
    api<SearchAnswer>(`/api/search${query({ q, journal: journalId })}`).then(
      (a) => !stale && setAnswer(a),
      (err: unknown) => !stale && onError(err),
    );
    return () => {
      stale = true;
    };
  }, [q, journalId, revision, onError]);

  const byId = new Map(journals.map((j) => [j.id, j]));

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8">
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="font-serif text-2xl text-stone-900">Search</h1>
        {answer && (
          <span className="text-sm text-stone-400">
            {answer.more
              ? `the newest ${answer.hits.length} of more`
              : answer.hits.length === 1
                ? "1 page"
                : `${answer.hits.length} pages`}
          </span>
        )}
        <div className="ml-auto">
          <JournalFilter
            journals={journals}
            value={journalId}
            onChange={(j) => go({ kind: "search", q, journalId: j }, true)}
          />
        </div>
      </header>

      {!q.trim() && <SearchHelp />}
      {answer && answer.hits.length === 0 && <p className="text-sm text-stone-500">No page matches.</p>}

      <ul className="space-y-2">
        {answer?.hits.map((hit) => {
          const journal = byId.get(hit.journalId);
          if (!journal) return null;
          return (
            <li key={`${hit.journalId}/${hit.date}`}>
              <Link
                to={{ kind: "day", journalId: hit.journalId, date: hit.date }}
                className="block rounded-lg border border-stone-200 bg-white px-4 py-3 hover:border-stone-300 hover:shadow-sm"
              >
                <div className="mb-1 flex flex-wrap items-center gap-x-2 text-xs text-stone-500">
                  <span className="font-medium text-stone-700">{longDate(hit.date)}</span>
                  {journals.length > 1 && (
                    <span className="inline-flex items-center gap-1">
                      <span className={`h-2 w-2 rounded-full ${JOURNAL_COLORS[journal.color].dot}`} aria-hidden />
                      {journal.name}
                    </span>
                  )}
                  {hit.mood && <span className={`h-2 w-2 rounded-full ${MOOD_COLORS[hit.mood].bg}`} aria-hidden />}
                </div>
                <p className="font-serif text-sm text-stone-700">
                  <Marked hit={hit} />
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The snippet, with what matched highlighted. */
function Marked({ hit }: { hit: SearchHit }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of hit.marks) {
    if (start > at) parts.push(hit.snippet.slice(at, start));
    parts.push(
      <mark key={start} className="rounded-sm bg-amber-200/80 px-0.5 text-inherit">
        {hit.snippet.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  parts.push(hit.snippet.slice(at));
  return <>{parts}</>;
}

function SearchHelp() {
  const rows: [string, string][] = [
    ["rain walk", "pages with both words, in any case and with or without accents"],
    ['"long walk"', "these words together"],
    ["-work", "pages without the word"],
    ["#travel", "pages with the tag, or a tag under it (#travel/japan)"],
    ["mood:5   mood:>=4   mood:<3", "by mood, from 1 (awful) to 5 (great)"],
    ["before:2026-01-01   after:2025-06-30", "by day"],
  ];
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 text-sm text-stone-600">
      <p className="mb-3">Type in the search box at the top of the sidebar. Everything you type must match:</p>
      <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[auto_1fr]">
        {rows.map(([example, meaning]) => (
          <div key={example} className="contents">
            <dt>
              <code className="rounded bg-stone-100 px-1.5 py-0.5 text-xs whitespace-pre text-stone-800">
                {example}
              </code>
            </dt>
            <dd className="text-stone-500">{meaning}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
