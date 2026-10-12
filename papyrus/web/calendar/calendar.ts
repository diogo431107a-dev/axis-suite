// Calendar arithmetic: the weeks of a month, which day a week starts on, and moods by day.
import { addDays, monthStart, weekday } from "../../shared/dates.ts";
import type { DaySummary, Mood, WeekStart } from "../../shared/protocol.ts";

/** The day weeks start on: the setting, else the browser's custom, else Monday. */
export function resolveWeekStart(setting: WeekStart, language = navigator.language): 0 | 1 | 6 {
  if (setting !== null) return setting;
  try {
    const locale = new Intl.Locale(language) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const firstDay = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay;
    // Intl counts 1 = Monday … 7 = Sunday.
    if (firstDay === 7) return 0;
    if (firstDay === 6) return 6;
  } catch {
    // an unknown language
  }
  return 1;
}

/** The weeks shown for a month: 7 days each, from the week of its 1st to the week of its last day. */
export function monthGrid(date: string, weekStart: number): string[][] {
  const first = monthStart(date);
  let day = addDays(first, -((weekday(first) - weekStart + 7) % 7));
  const weeks: string[][] = [];
  do {
    const week: string[] = [];
    for (let i = 0; i < 7; i++, day = addDays(day, 1)) week.push(day);
    weeks.push(week);
  } while (day.slice(0, 7) === first.slice(0, 7));
  return weeks;
}

/** Each day's pages. */
export function byDay(days: readonly DaySummary[]): Map<string, DaySummary[]> {
  const map = new Map<string, DaySummary[]>();
  for (const d of days) {
    const list = map.get(d.date);
    if (list) list.push(d);
    else map.set(d.date, [d]);
  }
  return map;
}

/** A day's mood across journals: the rounded average of those that have one. */
export function dayMood(pages: readonly DaySummary[] | undefined): Mood | null {
  const moods = (pages ?? []).map((p) => p.mood).filter((m) => m !== null);
  if (moods.length === 0) return null;
  return Math.round(moods.reduce((a, b) => a + b, 0) / moods.length) as Mood;
}
