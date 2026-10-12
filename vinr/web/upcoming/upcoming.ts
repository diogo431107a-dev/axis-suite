// Birthdays and other dates coming up, worked out from the contacts the page already has.
import { ageOn, daysBetween, nextOccurrence } from "../../shared/dates.ts";
import type { ContactSummary } from "../../shared/protocol.ts";

export interface Occasion {
  contact: ContactSummary;
  /** "Birthday", or the date's own label ("Anniversary"; "Date" when it has none) */
  label: string;
  birthday: boolean;
  /** when it comes round next, YYYY-MM-DD */
  on: string;
  /** days from today */
  inDays: number;
  /** the age reached (birthdays), or the years since (other dates), when the year is known */
  years: number | null;
}

/** Every birthday and date in the next `days` days (today included), soonest first. */
export function upcoming(contacts: readonly ContactSummary[], today: string, days: number): Occasion[] {
  const found: Occasion[] = [];
  const add = (contact: ContactSummary, date: string, label: string, birthday: boolean) => {
    const on = nextOccurrence(date, today);
    const inDays = daysBetween(today, on);
    if (inDays >= days) return;
    found.push({ contact, label, birthday, on, inDays, years: ageOn(date, on) });
  };
  for (const c of contacts) {
    if (c.birthday) add(c, c.birthday, "Birthday", true);
    for (const d of c.dates) add(c, d.date, d.label || "Date", false);
  }
  return found.sort((a, b) => a.inDays - b.inDays || Number(b.birthday) - Number(a.birthday));
}
