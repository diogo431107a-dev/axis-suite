import { useEffect, useRef, useState } from "react";
import {
  ArchiveRestore,
  CalendarDays,
  Download,
  FileText,
  Flame,
  Grid3x3,
  Pencil,
  Plus,
  Search,
  Settings as SettingsIcon,
  Trash2,
  User,
} from "lucide-react";
import type { Me } from "@axis-suite/heimdall-client/browser";
import type { Journal, TagCount } from "../shared/protocol.ts";
import { MiniCalendar } from "./calendar/MiniCalendar.tsx";
import { JOURNAL_COLORS } from "./colors.ts";
import { go, type Route } from "./nav.ts";
import { AboutButton } from "./ui/About.tsx";
import { iconButton } from "./ui/buttons.ts";
import { Link } from "./ui/Link.tsx";

export type SidebarDialog = "journal" | "templates" | "settings" | "backup";

interface SidebarProps {
  me: Me;
  route: Route;
  journals: Journal[];
  /** the journal of the day shown, or the last one opened */
  journal: Journal;
  /** the day shown, or today */
  date: string;
  today: string;
  weekStart: number;
  tags: TagCount[];
  streak: number;
  binCount: number;
  revision: number;
  onDialog: (dialog: SidebarDialog, journal?: Journal) => void;
  /** a link was followed: on a phone, the menu closes */
  onNavigate: () => void;
  onError: (err: unknown) => void;
}

const navItem = (active: boolean) =>
  `flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
    active ? "bg-amber-100/80 font-medium text-amber-950" : "text-stone-600 hover:bg-stone-200/60 hover:text-stone-900"
  }`;

export function Sidebar(props: SidebarProps) {
  const { me, route, journals, journal, date, today, weekStart, tags, streak, binCount, revision } = props;
  const { onDialog, onNavigate, onError } = props;
  const searching = route.kind === "search" ? route.q : "";
  const [q, setQ] = useState(searching);
  const searchInput = useRef<HTMLInputElement>(null);

  useEffect(() => setQ(searching), [searching]);

  // Typing searches as it goes (the search view follows the address).
  useEffect(() => {
    if (q === searching || (!q && route.kind !== "search")) return;
    const timer = setTimeout(() => go({ kind: "search", q, journalId: null }, route.kind === "search"), 300);
    return () => clearTimeout(timer);
  }, [q, searching, route.kind]);

  const filter = (r: Route) => ("journalId" in r ? r.journalId : null);

  return (
    <nav className="flex h-full flex-col gap-4 overflow-y-auto py-4" aria-label="Journals">
      <div className="flex px-3">
        <AboutButton className="flex items-center gap-2 px-1">
          <img src="/favicon.svg" alt="" className="h-6 w-6" />
          <span className="font-serif text-lg font-semibold text-stone-800">Papyrus</span>
        </AboutButton>
      </div>

      <div className="px-3">
        <label className="relative block">
          <span className="sr-only">Search</span>
          <Search className="pointer-events-none absolute top-2 left-2.5 h-4 w-4 text-stone-400" aria-hidden />
          <input
            ref={searchInput}
            data-search
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                go({ kind: "search", q, journalId: null }, route.kind === "search");
                onNavigate();
              }
            }}
            placeholder="Search  ( / )"
            className="w-full rounded-md border border-stone-200 bg-white py-1.5 pr-2 pl-8 text-sm placeholder-stone-400
              focus:border-transparent focus:ring-2 focus:ring-amber-400 focus:outline-none"
          />
        </label>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between px-4">
          <h2 className="text-xs font-semibold tracking-wide text-stone-400 uppercase">Journals</h2>
          <button
            type="button"
            className={iconButton}
            aria-label="New journal"
            title="New journal"
            onClick={() => onDialog("journal")}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <ul className="space-y-0.5 px-2">
          {journals.map((j) => (
            <li key={j.id} className="group relative">
              <Link
                to={{ kind: "day", journalId: j.id, date }}
                onClick={onNavigate}
                className={navItem(route.kind === "day" && route.journalId === j.id)}
              >
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${JOURNAL_COLORS[j.color].dot}`} aria-hidden />
                <span className="truncate">{j.name}</span>
                <span className="ml-auto pr-6 text-xs text-stone-400">{j.pages || ""}</span>
              </Link>
              <button
                type="button"
                onClick={() => onDialog("journal", j)}
                aria-label={`Edit ${j.name}`}
                title="Name, colour, template"
                className="absolute top-1/2 right-1 -translate-y-1/2 rounded p-1 text-stone-400 opacity-0 group-hover:opacity-100
                  hover:bg-stone-200 hover:text-stone-700 focus:opacity-100"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <MiniCalendar
        journalId={journal.id}
        date={date}
        today={today}
        weekStart={weekStart}
        revision={revision}
        onPick={onNavigate}
        onError={onError}
      />

      {streak > 0 && (
        <p
          className="flex items-center gap-2 px-4 text-xs text-stone-500"
          title="Days in a row with a page, in any journal"
        >
          <Flame className="h-4 w-4 text-orange-500" aria-hidden />
          {streak === 1 ? "1 day in a row" : `${streak} days in a row`}
        </p>
      )}

      <ul className="space-y-0.5 px-2">
        <li>
          <Link
            to={{ kind: "month", month: date, journalId: filter(route) }}
            onClick={onNavigate}
            className={navItem(route.kind === "month")}
          >
            <CalendarDays className="h-4 w-4" aria-hidden /> Calendar
          </Link>
        </li>
        <li>
          <Link
            to={{ kind: "year", year: Number(date.slice(0, 4)), journalId: filter(route) }}
            onClick={onNavigate}
            className={navItem(route.kind === "year")}
          >
            <Grid3x3 className="h-4 w-4" aria-hidden /> Year in moods
          </Link>
        </li>
      </ul>

      {tags.length > 0 && (
        <div>
          <h2 className="mb-1 px-4 text-xs font-semibold tracking-wide text-stone-400 uppercase">Tags</h2>
          <ul className="flex flex-wrap gap-1 px-3">
            {tags.map((t) => (
              <li key={t.tag}>
                <Link
                  to={{ kind: "search", q: `#${t.tag}`, journalId: null }}
                  onClick={onNavigate}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                    searching === `#${t.tag}`
                      ? "bg-amber-200 text-amber-950"
                      : "bg-stone-200/60 text-stone-600 hover:bg-amber-100 hover:text-amber-900"
                  }`}
                >
                  #{t.tag}
                  <span className="text-stone-400">{t.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="mt-auto space-y-0.5 px-2">
        <li>
          <button type="button" className={navItem(false)} onClick={() => onDialog("templates")}>
            <FileText className="h-4 w-4" aria-hidden /> Templates
          </button>
        </li>
        <li>
          <button type="button" className={navItem(false)} onClick={() => onDialog("settings")}>
            <SettingsIcon className="h-4 w-4" aria-hidden /> Settings
          </button>
        </li>
        <li>
          <button type="button" className={navItem(false)} onClick={() => onDialog("backup")}>
            <Download className="h-4 w-4" aria-hidden /> Export and import
          </button>
        </li>
        <li>
          <Link to={{ kind: "bin" }} onClick={onNavigate} className={navItem(route.kind === "bin")}>
            {binCount > 0 ? (
              <ArchiveRestore className="h-4 w-4" aria-hidden />
            ) : (
              <Trash2 className="h-4 w-4" aria-hidden />
            )}
            Recycle bin
            {binCount > 0 && <span className="ml-auto text-xs text-stone-400">{binCount}</span>}
          </Link>
        </li>
        <li>
          <a href={me.accountUrl} className={navItem(false)} title="Your Heimdall account, where you sign out">
            <User className="h-4 w-4" aria-hidden />
            <span className="truncate">{me.name}</span>
          </a>
        </li>
      </ul>
    </nav>
  );
}
