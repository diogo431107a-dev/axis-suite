import { useMemo } from "react";
import { Cake, CalendarHeart } from "lucide-react";
import { displayName } from "../../shared/contact.ts";
import type { ContactSummary } from "../../shared/protocol.ts";
import { dayOfMonth, monthName, whenFrom } from "../format.ts";
import { HOME, withOpen } from "../nav.ts";
import { Avatar } from "../ui/Avatar.tsx";
import { Link } from "../ui/Link.tsx";
import { upcoming } from "./upcoming.ts";

interface UpcomingViewProps {
  contacts: ContactSummary[];
  today: string;
}

/** What the years mean: the age reached on a birthday, the years since on another date. */
function yearsText(years: number | null, birthday: boolean): string {
  if (years === null) return "";
  if (birthday) return `turns ${years}`;
  return years === 0 ? "" : `${years} ${years === 1 ? "year" : "years"}`;
}

/** Birthdays and other dates of the next twelve months, month by month. */
export function UpcomingView({ contacts, today }: UpcomingViewProps) {
  const months = useMemo(() => {
    const out: { month: string; rows: ReturnType<typeof upcoming> }[] = [];
    for (const o of upcoming(contacts, today, 366)) {
      const month = o.on.slice(0, 7);
      if (out.at(-1)?.month !== month) out.push({ month, rows: [] });
      out.at(-1)!.rows.push(o);
    }
    return out;
  }, [contacts, today]);

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8">
      <h1 className="mb-1 text-2xl font-semibold text-stone-900">Upcoming</h1>
      <p className="mb-5 text-sm text-stone-500">Birthdays and other dates in the next twelve months.</p>
      {months.length === 0 && (
        <p className="text-sm text-stone-400">No birthdays or dates yet. Add them when you edit a contact.</p>
      )}
      {months.map(({ month, rows }) => (
        <div key={month} className="mb-6">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-stone-400 uppercase">
            {monthName(`${month}-01`)}
          </h2>
          <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
            {rows.map((o) => {
              const soon = o.inDays < 7;
              const Icon = o.birthday ? Cake : CalendarHeart;
              return (
                <li key={`${o.contact.id}-${o.label}-${o.on}`}>
                  <Link
                    to={withOpen(HOME, { kind: "contact", id: o.contact.id, edit: false })}
                    className={`flex items-center gap-3 px-4 py-2.5 hover:bg-stone-50 ${o.inDays === 0 ? "bg-teal-50" : ""}`}
                  >
                    <span className="w-14 shrink-0 text-sm text-stone-500">{dayOfMonth(o.on)}</span>
                    <Avatar contact={o.contact} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-stone-800">
                        {displayName(o.contact)}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-stone-500">
                        <Icon className="h-3.5 w-3.5" aria-hidden />
                        {[o.label, yearsText(o.years, o.birthday)].filter(Boolean).join(", ")}
                      </span>
                    </span>
                    <span className={`shrink-0 text-xs ${soon ? "font-medium text-teal-700" : "text-stone-400"}`}>
                      {whenFrom(o.on, today)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
