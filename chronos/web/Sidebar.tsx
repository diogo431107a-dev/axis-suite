import {
  CalendarDays,
  Database,
  Eye,
  EyeOff,
  List,
  Pencil,
  Plus,
  Settings as SettingsIcon,
  Upload,
  User,
} from "lucide-react";
import type { Me } from "@axis-suite/heimdall-client/browser";
import type { Calendar } from "../shared/protocol.ts";
import { CAL_COLORS } from "./colors.ts";
import { MiniMonth } from "./inputs/MiniMonth.tsx";
import type { Route } from "./nav.ts";
import { iconButton, primaryButton } from "./ui/buttons.ts";
import { Link } from "./ui/Link.tsx";

export type SidebarDialog = "calendar" | "import" | "settings" | "backup";

interface SidebarProps {
  me: Me;
  route: Route;
  calendars: Calendar[];
  today: string;
  /** the month the small calendar shows */
  miniMonth: string;
  onMiniMonth: (month: string) => void;
  /** a day picked in the small calendar */
  onDay: (date: string) => void;
  onNewEvent: () => void;
  onToggle: (calendar: Calendar) => void;
  onDialog: (dialog: SidebarDialog, calendar?: Calendar) => void;
  /** a link was followed: on a phone, the menu closes */
  onNavigate: () => void;
}

const navItem = (active: boolean) =>
  `flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
    active
      ? "bg-indigo-100/80 font-medium text-indigo-950"
      : "text-stone-600 hover:bg-stone-200/60 hover:text-stone-900"
  }`;

export function Sidebar(props: SidebarProps) {
  const { me, route, calendars, today, onToggle, onDialog, onNavigate } = props;

  return (
    <nav className="flex h-full flex-col gap-4 overflow-y-auto py-4" aria-label="Calendars">
      <div className="flex items-center gap-2 px-4">
        <img src="/favicon.svg" alt="" className="h-6 w-6" />
        <span className="text-lg font-semibold text-stone-800">Chronos</span>
      </div>

      <div className="px-3">
        <button
          type="button"
          className={`${primaryButton} w-full`}
          onClick={props.onNewEvent}
          disabled={calendars.length === 0}
          title={calendars.length === 0 ? "Make or import a calendar first" : "New event (N)"}
        >
          <Plus className="h-4 w-4" aria-hidden /> New event
        </button>
      </div>

      <div className="px-3">
        <MiniMonth month={props.miniMonth} onMonth={props.onMiniMonth} today={today} onPick={props.onDay} />
      </div>

      <ul className="space-y-0.5 px-2">
        <li>
          <Link
            to={{ view: { kind: "month", month: null }, open: null }}
            onClick={onNavigate}
            className={navItem(route.view.kind === "month")}
          >
            <CalendarDays className="h-4 w-4" aria-hidden /> Month
          </Link>
        </li>
        <li>
          <Link
            to={{ view: { kind: "agenda" }, open: null }}
            onClick={onNavigate}
            className={navItem(route.view.kind === "agenda")}
          >
            <List className="h-4 w-4" aria-hidden /> Agenda
          </Link>
        </li>
      </ul>

      <div>
        <div className="mb-1 flex items-center justify-between px-4">
          <h2 className="text-xs font-semibold tracking-wide text-stone-400 uppercase">Calendars</h2>
          <button
            type="button"
            className={iconButton}
            aria-label="New calendar"
            title="New calendar"
            onClick={() => onDialog("calendar")}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {calendars.length === 0 && (
          <p className="px-4 text-xs text-stone-400">None yet. Make one with +, or import an .ics file.</p>
        )}
        <ul className="space-y-0.5 px-2">
          {calendars.map((c) => (
            <li key={c.id} className="group flex items-center gap-1 rounded-md pr-1 hover:bg-stone-200/60">
              <button
                type="button"
                onClick={() => onToggle(c)}
                aria-pressed={c.visible}
                title={c.visible ? "Shown; click to hide" : "Hidden; click to show"}
                className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-sm"
              >
                <span
                  className={`h-3 w-3 shrink-0 rounded-sm ${c.visible ? CAL_COLORS[c.color].dot : "border-2 border-stone-300"}`}
                  aria-hidden
                />
                <span className={`truncate ${c.visible ? "text-stone-700" : "text-stone-400"}`}>{c.name}</span>
                {c.visible ? (
                  <Eye
                    className="ml-auto h-3.5 w-3.5 shrink-0 text-stone-300 opacity-0 group-hover:opacity-100"
                    aria-hidden
                  />
                ) : (
                  <EyeOff className="ml-auto h-3.5 w-3.5 shrink-0 text-stone-400" aria-hidden />
                )}
              </button>
              <button
                type="button"
                onClick={() => onDialog("calendar", c)}
                aria-label={`Edit ${c.name}`}
                title="Name, colour, export, import, delete"
                className="rounded p-1 text-stone-400 opacity-0 group-hover:opacity-100 hover:bg-stone-200 hover:text-stone-700 focus:opacity-100 max-md:opacity-100"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <ul className="mt-auto space-y-0.5 px-2">
        <li>
          <button type="button" className={navItem(false)} onClick={() => onDialog("import")}>
            <Upload className="h-4 w-4" aria-hidden /> Import .ics
          </button>
        </li>
        <li>
          <button type="button" className={navItem(false)} onClick={() => onDialog("settings")}>
            <SettingsIcon className="h-4 w-4" aria-hidden /> Settings
          </button>
        </li>
        <li>
          <button type="button" className={navItem(false)} onClick={() => onDialog("backup")}>
            <Database className="h-4 w-4" aria-hidden /> Backup
          </button>
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
