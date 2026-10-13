// Repeating events (RRULE) in imported files become plain events. Chronos itself has no repeating
// events: a file's rule is unrolled once, at import, into the occurrences that fall in a window.
//
// The rule runs on wall-clock time, in the event's own zone, with each wall time held in a Date
// as if it were UTC (rrule's "floating" dates). A weekly 09:00 in London stays 09:00 in London
// after the clocks change; the caller turns each wall time into an instant afterwards.

import { RRule } from "rrule";

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** "2026-11-08T14:00:00" or "2026-11-08" as a floating Date. */
function floating(wall: string): Date {
  const d = new Date(
    Date.UTC(
      Number(wall.slice(0, 4)),
      Number(wall.slice(5, 7)) - 1,
      Number(wall.slice(8, 10)),
      Number(wall.slice(11, 13) || 0),
      Number(wall.slice(14, 16) || 0),
      Number(wall.slice(17, 19) || 0),
    ),
  );
  d.setUTCFullYear(Number(wall.slice(0, 4)));
  return d;
}

/** A floating Date as "YYYY-MM-DDTHH:MM:SS". */
const wallOf = (d: Date) =>
  `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T` +
  `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

export interface Expansion {
  /** wall times ("YYYY-MM-DDTHH:MM:SS"), in order */
  walls: string[];
  /** more occurrences fell in the window than the limit */
  truncated: boolean;
}

/**
 * The occurrences of a rule (the RRULE value, "FREQ=WEEKLY;BYDAY=MO") starting at `start` (a wall
 * time) that fall between two dates, both included, at most `limit` of them. `until` is the
 * rule's UNTIL as a wall time in the same zone (worked out by the caller), or null.
 */
export function expandRule(
  rule: string,
  start: string,
  until: string | null,
  window: { from: string; to: string },
  limit: number,
): Expansion {
  // UNTIL is taken out: its zone is the caller's business.
  const rest = rule
    .replace(/^RRULE:/i, "")
    .split(";")
    .filter((part) => part && !/^UNTIL=/i.test(part))
    .join(";");
  const options = RRule.parseString(rest);
  options.dtstart = floating(start);
  options.until = until ? floating(until) : null;
  options.tzid = null;
  const walls: string[] = [];
  let truncated = false;
  new RRule(options).between(floating(`${window.from}T00:00:00`), floating(`${window.to}T23:59:59`), true, (d) => {
    if (walls.length >= limit) {
      truncated = true;
      return false;
    }
    walls.push(wallOf(d));
    return true;
  });
  return { walls, truncated };
}
