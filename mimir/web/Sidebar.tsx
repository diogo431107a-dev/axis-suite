import { useRef } from "react";
import { Database, FileUp, Keyboard, Plus, User } from "lucide-react";
import type { Me } from "@axis-suite/heimdall-client/browser";
import type { MapSummary } from "../shared/protocol.ts";
import { iconButton, primaryButton } from "./ui/buttons.ts";
import { Link } from "./ui/Link.tsx";
import { startSort } from "./ui/sort.ts";

export type SidebarDialog = "backup" | "keys";

interface SidebarProps {
  me: Me;
  maps: MapSummary[];
  activeId: string | null;
  busy: boolean;
  onNewMap: () => void;
  /** an OPML file to make a map of */
  onImport: (file: File) => void;
  /** a map dragged (or moved with Ctrl+Shift+↑/↓) to an index among the others */
  onMoveMap: (map: MapSummary, index: number) => void;
  onDialog: (dialog: SidebarDialog) => void;
  /** a link was followed: on a phone, the menu closes */
  onNavigate: () => void;
}

const navItem = (active: boolean) =>
  `flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
    active
      ? "bg-fuchsia-100/80 font-medium text-fuchsia-950"
      : "text-stone-600 hover:bg-stone-200/60 hover:text-stone-900"
  }`;

export function Sidebar({
  me,
  maps,
  activeId,
  busy,
  onNewMap,
  onImport,
  onMoveMap,
  onDialog,
  onNavigate,
}: SidebarProps) {
  const list = useRef<HTMLUListElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const rows = () => [...(list.current?.querySelectorAll<HTMLElement>("[data-map-row]") ?? [])];

  return (
    <nav className="flex h-full flex-col gap-4 overflow-y-auto py-4" aria-label="Maps">
      <div className="flex items-center gap-2 px-4">
        <img src="/favicon.svg" alt="" className="h-6 w-6" />
        <span className="text-lg font-semibold text-stone-800">Mimir</span>
      </div>

      <div className="px-3">
        <button type="button" className={`${primaryButton} w-full`} disabled={busy} onClick={onNewMap}>
          <Plus className="h-4 w-4" aria-hidden /> New map
        </button>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between px-4">
          <h2 className="text-xs font-semibold tracking-wide text-stone-400 uppercase">Maps</h2>
          <button
            type="button"
            className={iconButton}
            aria-label="Import an OPML file as a new map"
            title="Import an OPML file as a new map"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <FileUp className="h-4 w-4" />
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".opml,.xml,text/x-opml,application/xml,text/xml"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) onImport(file);
            }}
          />
        </div>
        {maps.length === 0 && <p className="px-4 text-xs text-stone-400">None yet. Make one with New map.</p>}
        <ul ref={list} className="space-y-0.5 px-2">
          {maps.map((m, i) => (
            <li
              key={m.id}
              data-map-row
              onPointerDown={(e) =>
                startSort(e, e.currentTarget, rows, (index) => onMoveMap(m, index), { ignore: "button, input" })
              }
              onKeyDown={(e) => {
                if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                e.preventDefault();
                const to = i + (e.key === "ArrowUp" ? -1 : 1);
                if (to < 0 || to >= maps.length) return;
                onMoveMap(m, to);
                // The row is redrawn in its new place: keep the focus on it.
                requestAnimationFrame(() => document.getElementById(`map-link-${m.id}`)?.focus());
              }}
            >
              <Link
                to={{ mapId: m.id, nodeId: null }}
                onClick={onNavigate}
                className={`${navItem(m.id === activeId)} select-none [-webkit-touch-callout:none]`}
                title="Drag, or Ctrl+Shift+↑/↓, to reorder"
                id={`map-link-${m.id}`}
              >
                <span className="truncate">{m.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <ul className="mt-auto space-y-0.5 px-2">
        <li>
          <button type="button" className={navItem(false)} onClick={() => onDialog("keys")}>
            <Keyboard className="h-4 w-4" aria-hidden /> Keyboard
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
