import { useEffect, useState } from "react";
import { History } from "lucide-react";
import type { DaySummary, Journal } from "../../shared/protocol.ts";
import { api, query } from "../api.ts";
import { JOURNAL_COLORS, MOOD_COLORS } from "../colors.ts";
import { longDate, yearsAgo } from "../format.ts";
import { Link } from "../ui/Link.tsx";

interface OnThisDayProps {
  date: string;
  journals: Journal[];
  /** changes after every save, so the list follows */
  revision: number;
  onError: (err: unknown) => void;
}

/** Pages from the same day in earlier years, in every journal. */
export function OnThisDay({ date, journals, revision, onError }: OnThisDayProps) {
  const [memories, setMemories] = useState<DaySummary[]>([]);

  useEffect(() => {
    let stale = false;
    api<DaySummary[]>(`/api/on-this-day${query({ date })}`).then(
      (list) => !stale && setMemories(list),
      (err: unknown) => !stale && onError(err),
    );
    return () => {
      stale = true;
    };
  }, [date, revision, onError]);

  const byId = new Map(journals.map((j) => [j.id, j]));
  const shown = memories.filter((m) => byId.has(m.journalId));
  if (shown.length === 0) return null;

  return (
    <section className="mt-10 border-t border-stone-200 pt-6" aria-labelledby="on-this-day">
      <h2
        id="on-this-day"
        className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wide text-stone-500 uppercase"
      >
        <History className="h-3.5 w-3.5" aria-hidden /> On this day
      </h2>
      <ul className="space-y-2">
        {shown.map((m) => {
          const journal = byId.get(m.journalId)!;
          return (
            <li key={`${m.journalId}/${m.date}`}>
              <Link
                to={{ kind: "day", journalId: m.journalId, date: m.date }}
                className="block rounded-lg border border-stone-200 bg-white px-4 py-3 hover:border-stone-300 hover:shadow-sm"
              >
                <div className="mb-1 flex flex-wrap items-center gap-x-2 text-xs text-stone-500">
                  <span className="font-medium text-stone-700">{yearsAgo(m.date, date)}</span>
                  <span>{longDate(m.date)}</span>
                  {journals.length > 1 && (
                    <span className="inline-flex items-center gap-1">
                      <span className={`h-2 w-2 rounded-full ${JOURNAL_COLORS[journal.color].dot}`} aria-hidden />
                      {journal.name}
                    </span>
                  )}
                  {m.mood && <span className={`h-2 w-2 rounded-full ${MOOD_COLORS[m.mood].bg}`} aria-hidden />}
                </div>
                <p className="font-serif text-sm text-stone-700">
                  {m.preview || <em className="text-stone-400">No text</em>}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
