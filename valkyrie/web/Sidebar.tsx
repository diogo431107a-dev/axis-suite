import { useRef } from "react";
import { Database, Keyboard, Plus, User } from "lucide-react";
import type { Me } from "@axis-suite/heimdall-client/browser";
import type { Board } from "../shared/protocol.ts";
import { startSort } from "./board/dnd.ts";
import { COLOR_CLASSES } from "./colors.ts";
import { AboutButton } from "./ui/About.tsx";
import { iconButton, primaryButton } from "./ui/buttons.ts";
import { Link } from "./ui/Link.tsx";

export type SidebarDialog = "new-board" | "backup" | "keys";

interface SidebarProps {
  me: Me;
  boards: Board[];
  activeId: string | null;
  /** a board dragged (or moved with Ctrl+Shift+↑/↓) to an index among the others */
  onMoveBoard: (board: Board, index: number) => void;
  onDialog: (dialog: SidebarDialog) => void;
  /** a link was followed: on a phone, the menu closes */
  onNavigate: () => void;
}

const navItem = (active: boolean) =>
  `flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
    active
      ? "bg-violet-100/80 font-medium text-violet-950"
      : "text-stone-600 hover:bg-stone-200/60 hover:text-stone-900"
  }`;

export function Sidebar({ me, boards, activeId, onMoveBoard, onDialog, onNavigate }: SidebarProps) {
  const list = useRef<HTMLUListElement>(null);
  const rows = () => [...(list.current?.querySelectorAll<HTMLElement>("[data-board-row]") ?? [])];

  return (
    <nav className="flex h-full flex-col gap-4 overflow-y-auto py-4" aria-label="Boards">
      <div className="flex px-3">
        <AboutButton className="flex items-center gap-2 px-1">
          <img src="/favicon.svg" alt="" className="h-6 w-6" />
          <span className="text-lg font-semibold text-stone-800">Valkyrie</span>
        </AboutButton>
      </div>

      <div className="px-3">
        <button type="button" className={`${primaryButton} w-full`} onClick={() => onDialog("new-board")}>
          <Plus className="h-4 w-4" aria-hidden /> New board
        </button>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between px-4">
          <h2 className="text-xs font-semibold tracking-wide text-stone-400 uppercase">Boards</h2>
          <button
            type="button"
            className={iconButton}
            aria-label="New board"
            title="New board"
            onClick={() => onDialog("new-board")}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {boards.length === 0 && <p className="px-4 text-xs text-stone-400">None yet. Make one with New board.</p>}
        <ul ref={list} className="space-y-0.5 px-2">
          {boards.map((b, i) => (
            <li
              key={b.id}
              data-board-row
              onPointerDown={(e) =>
                startSort(e, e.currentTarget, rows, (index) => onMoveBoard(b, index), { ignore: "button, input" })
              }
              onKeyDown={(e) => {
                if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                e.preventDefault();
                const to = i + (e.key === "ArrowUp" ? -1 : 1);
                if (to < 0 || to >= boards.length) return;
                onMoveBoard(b, to);
                // The row is redrawn in its new place: keep the focus on it.
                requestAnimationFrame(() => document.getElementById(`board-link-${b.id}`)?.focus());
              }}
            >
              <Link
                to={{ boardId: b.id, cardId: null }}
                onClick={onNavigate}
                className={`${navItem(b.id === activeId)} select-none [-webkit-touch-callout:none]`}
                title="Drag, or Ctrl+Shift+↑/↓, to reorder"
                id={`board-link-${b.id}`}
              >
                <span className={`h-3 w-3 shrink-0 rounded-sm ${COLOR_CLASSES[b.color].dot}`} aria-hidden />
                <span className="truncate">{b.name}</span>
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
