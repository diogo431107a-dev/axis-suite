// Dates as bullets write them (YYYY-MM-DD, in the browser's time zone) and as chips show them.

/** Today in the browser's time zone, as YYYY-MM-DD. */
export function localDate(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The day after an ISO date. */
export function nextDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return localDate(new Date(y!, m! - 1, d! + 1));
}

const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const SHORT_DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const LONG_DATE = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });

/** "Today", "Tomorrow", a weekday within the next week, or the date itself. */
export function dateLabel(date: string, today: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(y!, m! - 1, d!);
  if (date === today) return "Today";
  if (date === nextDay(today)) return "Tomorrow";
  if (nextDay(date) === today) return "Yesterday";
  const days = Math.round((day.getTime() - new Date(`${today}T00:00`).getTime()) / 86_400_000);
  if (days > 1 && days < 7) return WEEKDAY.format(day);
  return (y === Number(today.slice(0, 4)) ? SHORT_DATE : LONG_DATE).format(day);
}
