import { useEffect, useMemo, useState } from "react";
import { Search, Star } from "lucide-react";
import { initialOf, listName } from "../../shared/contact.ts";
import type { ContactSummary, Settings } from "../../shared/protocol.ts";
import { go, withOpen, type Route } from "../nav.ts";
import { Avatar } from "../ui/Avatar.tsx";
import { Link } from "../ui/Link.tsx";

interface ContactListProps {
  route: Extract<Route, { kind: "contacts" }>;
  /** what to show: the filter's contacts, or what the search found; null while loading */
  contacts: ContactSummary[] | null;
  /** "All contacts", "Favourites", a group's name */
  title: string;
  sortBy: Settings["sortBy"];
  onStar: (contact: ContactSummary) => void;
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** A contact's second line: what they do and where, or else how to reach them. */
function subtitle(c: ContactSummary): string {
  const work = [c.title, c.company].filter(Boolean).join(" · ");
  const named = c.firstName || c.lastName || c.nickname;
  // A contact shown by its company has the company as its name already.
  if (work && (named || c.title)) return work;
  return c.phone || c.email;
}

/** The contacts of the sidebar's choice, A to Z under letter headings, with the search box above. */
export function ContactList({ route, contacts, title, sortBy, onStar }: ContactListProps) {
  const [q, setQ] = useState(route.q);
  useEffect(() => setQ(route.q), [route.q]);

  // Typing searches as it goes; the address keeps the search (Back undoes the whole search).
  useEffect(() => {
    if (q === route.q) return;
    const timer = setTimeout(() => go({ ...route, q }, true), 150);
    return () => clearTimeout(timer);
  }, [q, route]);

  const sections = useMemo(() => {
    if (!contacts) return [];
    const sorted = contacts
      .map((c) => ({ c, name: listName(c, sortBy) }))
      .sort((a, b) => collator.compare(a.name, b.name) || a.c.id.localeCompare(b.c.id));
    const out: { letter: string; rows: typeof sorted }[] = [];
    for (const row of sorted) {
      const letter = initialOf(row.c, sortBy);
      if (out.at(-1)?.letter !== letter) out.push({ letter, rows: [] });
      out.at(-1)!.rows.push(row);
    }
    // Names without a letter (numbers, symbols) go last.
    return [...out.filter((s) => s.letter !== "#"), ...out.filter((s) => s.letter === "#")];
  }, [contacts, sortBy]);

  const openId = route.open?.kind === "contact" ? route.open.id : null;

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={title}>
      <div className="border-b border-stone-200 px-3 py-3">
        <div className="mb-2 flex items-baseline justify-between px-1">
          <h1 className="truncate font-semibold text-stone-800">{title}</h1>
          {contacts && <span className="text-xs text-stone-400">{contacts.length}</span>}
        </div>
        <label className="relative block">
          <span className="sr-only">Search</span>
          <Search className="pointer-events-none absolute top-2 left-2.5 h-4 w-4 text-stone-400" aria-hidden />
          <input
            data-search
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && q) {
                e.stopPropagation();
                setQ("");
              }
            }}
            placeholder="Search  ( / )"
            className="w-full rounded-md border border-stone-200 bg-white py-1.5 pr-2 pl-8 text-sm placeholder-stone-400
              focus:border-transparent focus:ring-2 focus:ring-teal-500 focus:outline-none"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {contacts === null && <p className="p-4 text-sm text-stone-400">Loading…</p>}
        {contacts?.length === 0 && (
          <p className="p-4 text-sm text-stone-500">
            {route.q ? "Nobody matches the search." : "No contacts here yet."}
          </p>
        )}
        {sections.map(({ letter, rows }) => (
          <div key={letter}>
            <h2 className="sticky top-0 z-10 border-b border-stone-100 bg-stone-50/95 px-4 py-0.5 text-xs font-semibold text-stone-400 backdrop-blur">
              {letter}
            </h2>
            <ul>
              {rows.map(({ c, name }) => (
                <li key={c.id} className="group relative">
                  <Link
                    to={withOpen(route, { kind: "contact", id: c.id, edit: false })}
                    className={`flex items-center gap-3 py-2 pr-10 pl-4 ${
                      c.id === openId ? "bg-teal-50" : "hover:bg-stone-100"
                    }`}
                  >
                    <Avatar contact={c} />
                    <span className="min-w-0">
                      <span
                        className={`block truncate text-sm ${c.id === openId ? "font-medium text-teal-950" : "text-stone-800"}`}
                      >
                        {name}
                      </span>
                      <span className="block truncate text-xs text-stone-500">{subtitle(c)}</span>
                    </span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => onStar(c)}
                    aria-label={c.favorite ? `Take ${name} out of the favourites` : `Add ${name} to the favourites`}
                    aria-pressed={c.favorite}
                    className={`absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 ${
                      c.favorite
                        ? "text-amber-500 hover:text-amber-600"
                        : "text-stone-300 opacity-0 group-hover:opacity-100 hover:text-stone-500 focus:opacity-100"
                    }`}
                  >
                    <Star className="h-4 w-4" fill={c.favorite ? "currentColor" : "none"} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
