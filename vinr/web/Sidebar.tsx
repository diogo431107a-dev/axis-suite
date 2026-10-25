import {
  ArchiveRestore,
  Cake,
  Download,
  Pencil,
  Plus,
  Settings as SettingsIcon,
  Star,
  Trash2,
  User,
  UserPlus,
  Users,
} from "lucide-react";
import type { Me } from "@axis-suite/heimdall-client/browser";
import type { Group } from "../shared/protocol.ts";
import { GROUP_COLORS } from "./colors.ts";
import { HOME, type Filter, type Route } from "./nav.ts";
import { AboutButton } from "./ui/About.tsx";
import { iconButton, primaryButton } from "./ui/buttons.ts";
import { Link } from "./ui/Link.tsx";

export type SidebarDialog = "group" | "settings" | "backup";

interface SidebarProps {
  me: Me;
  route: Route;
  groups: Group[];
  /** contacts outside the bin, favourites among them, dates in the next week, contacts in the bin */
  counts: { all: number; favorites: number; soon: number; bin: number };
  onDialog: (dialog: SidebarDialog, group?: Group) => void;
  /** a link was followed: on a phone, the menu closes */
  onNavigate: () => void;
}

const navItem = (active: boolean) =>
  `flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
    active ? "bg-teal-100/80 font-medium text-teal-950" : "text-stone-600 hover:bg-stone-200/60 hover:text-stone-900"
  }`;

const list = (filter: Filter): Route => ({ kind: "contacts", filter, q: "", open: null });

export function Sidebar({ me, route, groups, counts, onDialog, onNavigate }: SidebarProps) {
  const filter = route.kind === "contacts" ? route.filter : null;
  const isFilter = (kind: Filter["kind"], id?: string) =>
    filter?.kind === kind && (kind !== "group" || (filter.kind === "group" && filter.id === id));
  const newContact: Route = {
    kind: "contacts",
    filter: filter ?? { kind: "all" },
    q: route.kind === "contacts" ? route.q : "",
    open: { kind: "new" },
  };

  return (
    <nav className="flex h-full flex-col gap-4 overflow-y-auto py-4" aria-label="Contacts">
      <div className="flex px-3">
        <AboutButton className="flex items-center gap-2 px-1">
          <img src="/favicon.svg" alt="" className="h-6 w-6" />
          <span className="text-lg font-semibold text-stone-800">Vinr</span>
        </AboutButton>
      </div>

      <div className="px-3">
        <Link to={newContact} onClick={onNavigate} className={`${primaryButton} w-full`}>
          <UserPlus className="h-4 w-4" aria-hidden /> New contact
        </Link>
      </div>

      <ul className="space-y-0.5 px-2">
        <li>
          <Link to={HOME} onClick={onNavigate} className={navItem(isFilter("all"))}>
            <Users className="h-4 w-4" aria-hidden /> All contacts
            <span className="ml-auto text-xs text-stone-400">{counts.all || ""}</span>
          </Link>
        </li>
        <li>
          <Link to={list({ kind: "favorites" })} onClick={onNavigate} className={navItem(isFilter("favorites"))}>
            <Star className="h-4 w-4" aria-hidden /> Favourites
            <span className="ml-auto text-xs text-stone-400">{counts.favorites || ""}</span>
          </Link>
        </li>
        <li>
          <Link to={{ kind: "upcoming" }} onClick={onNavigate} className={navItem(route.kind === "upcoming")}>
            <Cake className="h-4 w-4" aria-hidden /> Upcoming
            {counts.soon > 0 && (
              <span
                className="ml-auto rounded-full bg-teal-600 px-1.5 text-xs font-medium text-white"
                title="Birthdays and dates in the next 7 days"
              >
                {counts.soon}
              </span>
            )}
          </Link>
        </li>
      </ul>

      <div>
        <div className="mb-1 flex items-center justify-between px-4">
          <h2 className="text-xs font-semibold tracking-wide text-stone-400 uppercase">Groups</h2>
          <button
            type="button"
            className={iconButton}
            aria-label="New group"
            title="New group"
            onClick={() => onDialog("group")}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {groups.length === 0 && <p className="px-4 text-xs text-stone-400">Family, work, clients… make one with +.</p>}
        <ul className="space-y-0.5 px-2">
          {groups.map((g) => (
            <li key={g.id} className="group relative">
              <Link
                to={list({ kind: "group", id: g.id })}
                onClick={onNavigate}
                className={navItem(isFilter("group", g.id))}
              >
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${GROUP_COLORS[g.color].dot}`} aria-hidden />
                <span className="truncate">{g.name}</span>
                <span className="ml-auto pr-6 text-xs text-stone-400">{g.members || ""}</span>
              </Link>
              <button
                type="button"
                onClick={() => onDialog("group", g)}
                aria-label={`Edit ${g.name}`}
                title="Name, colour"
                className="absolute top-1/2 right-1 -translate-y-1/2 rounded p-1 text-stone-400 opacity-0 group-hover:opacity-100
                  hover:bg-stone-200 hover:text-stone-700 focus:opacity-100"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <ul className="mt-auto space-y-0.5 px-2">
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
            {counts.bin > 0 ? (
              <ArchiveRestore className="h-4 w-4" aria-hidden />
            ) : (
              <Trash2 className="h-4 w-4" aria-hidden />
            )}
            Recycle bin
            {counts.bin > 0 && <span className="ml-auto text-xs text-stone-400">{counts.bin}</span>}
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
