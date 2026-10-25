import { memo, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  DatabaseBackup,
  Folder,
  FolderOpen,
  FolderPlus,
  KeyRound,
  Layers,
  Pencil,
  Trash2,
  UserRound,
  WandSparkles,
} from "lucide-react";
import type { Me } from "@axis-suite/heimdall-client/browser";
import type { EntrySummary, Group } from "../../shared/protocol.ts";
import { compareText } from "../util.ts";
import { iconButton } from "../ui/buttons.ts";
import { AboutButton } from "../ui/About.tsx";

/** What the entry list shows. */
export type View = { kind: "all" } | { kind: "group"; id: string } | { kind: "bin" };

interface SidebarProps {
  me: Me;
  groups: Group[];
  entries: EntrySummary[];
  view: View;
  onView: (view: View) => void;
  onNewGroup: (parentId: string | null) => void;
  onEditGroup: (group: Group) => void;
  onDeleteGroup: (group: Group) => void;
  onGenerator: () => void;
  onBackup: () => void;
}

const itemClass = (selected: boolean) =>
  `w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors ${
    selected ? "bg-blue-50 text-blue-800 font-medium" : "text-gray-700 hover:bg-gray-100"
  }`;

/** The vault's views: all entries, the tree of groups, the recycle bin; and the tools. */
export const Sidebar = memo(function Sidebar(props: SidebarProps) {
  const { me, groups, entries, view, onView } = props;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const children = useMemo(() => {
    const map = new Map<string | null, Group[]>();
    for (const g of groups) map.set(g.parentId, [...(map.get(g.parentId) ?? []), g]);
    for (const list of map.values()) list.sort((a, b) => compareText(a.name, b.name));
    return map;
  }, [groups]);

  const counts = useMemo(() => {
    const map = new Map<string | null, number>();
    let bin = 0;
    for (const e of entries) {
      if (e.deletedAt) bin++;
      else map.set(e.groupId, (map.get(e.groupId) ?? 0) + 1);
    }
    return { map, bin, all: entries.length - bin };
  }, [entries]);

  const selectedGroup = view.kind === "group" ? groups.find((g) => g.id === view.id) : undefined;

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const renderGroups = (parentId: string | null, depth: number) =>
    children.get(parentId)?.map((g) => {
      const hasChildren = children.has(g.id);
      const open = !collapsed.has(g.id);
      const selected = view.kind === "group" && view.id === g.id;
      return (
        <li key={g.id}>
          <div className="flex items-center" style={{ paddingLeft: depth * 14 }}>
            <button
              type="button"
              onClick={() => toggle(g.id)}
              className={`p-0.5 text-gray-400 hover:text-gray-700 ${hasChildren ? "" : "invisible"}`}
              aria-label={open ? `Collapse ${g.name}` : `Expand ${g.name}`}
            >
              {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
            <button type="button" className={itemClass(selected)} onClick={() => onView({ kind: "group", id: g.id })}>
              {selected ? (
                <FolderOpen className="w-4 h-4 shrink-0 text-blue-700" />
              ) : (
                <Folder className="w-4 h-4 shrink-0 text-gray-400" />
              )}
              <span className="truncate flex-1">{g.name}</span>
              <span className="text-xs text-gray-400 tabular-nums">{counts.map.get(g.id) || ""}</span>
            </button>
          </div>
          {hasChildren && open && <ul>{renderGroups(g.id, depth + 1)}</ul>}
        </li>
      );
    });

  return (
    <nav className="flex flex-col h-full" aria-label="Vault">
      <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-gray-800 tracking-tight">
          <AboutButton className="-mx-1 flex items-center gap-2 px-1">
            <KeyRound className="w-5 h-5 text-blue-700" /> Janus
          </AboutButton>
        </h1>
        <a
          href={me.accountUrl}
          title={`Signed in as ${me.username}. Manage your session.`}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-700 transition-colors truncate"
        >
          <UserRound className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{me.name}</span>
        </a>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <button type="button" className={itemClass(view.kind === "all")} onClick={() => onView({ kind: "all" })}>
          <Layers className="w-4 h-4 shrink-0 text-gray-400" />
          <span className="flex-1">All entries</span>
          <span className="text-xs text-gray-400 tabular-nums">{counts.all || ""}</span>
        </button>

        <div className="mt-4 mb-1 flex items-center justify-between pl-2">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Groups</span>
          <button
            type="button"
            className={iconButton}
            onClick={() => props.onNewGroup(selectedGroup?.id ?? null)}
            aria-label={selectedGroup ? `New group in ${selectedGroup.name}` : "New group"}
            title={selectedGroup ? `New group in ${selectedGroup.name}` : "New group"}
          >
            <FolderPlus className="w-4 h-4" />
          </button>
        </div>
        {groups.length === 0 ? (
          <p className="px-2 py-1 text-xs text-gray-400">No groups yet.</p>
        ) : (
          <ul>{renderGroups(null, 0)}</ul>
        )}

        {selectedGroup && (
          <div className="mt-2 flex gap-1 pl-2">
            <button
              type="button"
              className={iconButton}
              onClick={() => props.onEditGroup(selectedGroup)}
              aria-label={`Rename or move ${selectedGroup.name}`}
              title="Rename or move"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              type="button"
              className={`${iconButton} hover:text-red-600`}
              onClick={() => props.onDeleteGroup(selectedGroup)}
              aria-label={`Delete ${selectedGroup.name}`}
              title="Delete (only when empty)"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="mt-4">
          <button type="button" className={itemClass(view.kind === "bin")} onClick={() => onView({ kind: "bin" })}>
            <Trash2 className="w-4 h-4 shrink-0 text-gray-400" />
            <span className="flex-1">Recycle bin</span>
            <span className="text-xs text-gray-400 tabular-nums">{counts.bin || ""}</span>
          </button>
        </div>
      </div>

      <div className="border-t border-gray-200 p-2 space-y-0.5">
        <button type="button" className={itemClass(false)} onClick={props.onGenerator}>
          <WandSparkles className="w-4 h-4 shrink-0 text-gray-400" /> Password generator
        </button>
        <button type="button" className={itemClass(false)} onClick={props.onBackup}>
          <DatabaseBackup className="w-4 h-4 shrink-0 text-gray-400" /> Export and import
        </button>
      </div>
    </nav>
  );
});
