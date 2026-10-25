import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Menu, Plus, X } from "lucide-react";
import {
  SignedOutError,
  fetchMe,
  goToSignIn,
  signInUrl,
  watchForSignIn,
  type Me,
} from "@axis-suite/heimdall-client/browser";
import type { Board } from "../shared/protocol.ts";
import { Sidebar, type SidebarDialog } from "./Sidebar.tsx";
import { api, describeError, setPageUser } from "./api.ts";
import { BoardView } from "./board/BoardView.tsx";
import { BackupDialog } from "./dialogs/BackupDialog.tsx";
import { BoardDialog } from "./dialogs/BoardDialog.tsx";
import { KeysDialog } from "./dialogs/KeysDialog.tsx";
import { useToday } from "./hooks.ts";
import { go, useRoute } from "./nav.ts";
import { AboutButton } from "./ui/About.tsx";
import { iconButton, primaryButton } from "./ui/buttons.ts";

interface Notice {
  text: string;
  tone: "info" | "error";
}

/** The board opened last on this device, for "/". */
const LAST_BOARD = "valkyrie:last-board";

function lastBoard(): string | null {
  try {
    return localStorage.getItem(LAST_BOARD);
  } catch {
    return null;
  }
}

function rememberBoard(id: string): void {
  try {
    localStorage.setItem(LAST_BOARD, id);
  } catch {
    // Not remembered; "/" opens the first board instead.
  }
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState("");
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [dialog, setDialog] = useState<SidebarDialog | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Set when the session ends mid-use. Holds the sign-in URL.
  const [signedOut, setSignedOut] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const route = useRoute();
  const today = useToday();

  const handleError = useCallback((err: unknown) => {
    if (err instanceof SignedOutError) setSignedOut(signInUrl(err.loginUrl));
    else setNotice({ text: describeError(err), tone: "error" });
  }, []);
  const info = useCallback((text: string) => setNotice({ text, tone: "info" }), []);

  const reloadBoards = useCallback(async () => {
    setBoards(await api<Board[]>("/api/boards"));
  }, []);
  const refreshBoards = useCallback(() => void reloadBoards().catch(handleError), [reloadBoards, handleError]);

  useEffect(() => {
    fetchMe()
      .then(async (user) => {
        setPageUser(user.username);
        setMe(user);
        await reloadBoards();
      })
      .catch((err: unknown) => {
        if (err instanceof SignedOutError) goToSignIn(err);
        else setLoadError("Could not load your boards. Try again in a moment.");
      });
  }, [reloadBoards]);

  // While signed out, check again whenever the user comes back to this tab (e.g. after signing
  // in from the banner's link). Someone else signing in gets a fresh page.
  useEffect(() => {
    if (!signedOut || !me) return;
    return watchForSignIn(me.username, () => {
      setSignedOut(null);
      refreshBoards();
    });
  }, [signedOut, me, refreshBoards]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  // "/" opens the board opened last here, or the first one.
  useEffect(() => {
    if (!boards || route.boardId) return;
    const last = lastBoard();
    const target = boards.find((b) => b.id === last) ?? boards[0];
    if (target) go({ boardId: target.id, cardId: null }, true);
  }, [boards, route.boardId]);

  useEffect(() => {
    if (route.boardId) rememberBoard(route.boardId);
  }, [route.boardId]);

  const current = boards?.find((b) => b.id === route.boardId);
  useEffect(() => {
    document.title = current ? `${current.name} · Valkyrie` : "Valkyrie";
  }, [current]);

  // ? anywhere but in a field: the keyboard keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement).closest("input, textarea, select, dialog, [contenteditable]")) return;
      e.preventDefault();
      setDialog("keys");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function moveBoard(board: Board, index: number) {
    if (!boards) return;
    const others = boards.filter((b) => b.id !== board.id);
    if (boards.indexOf(board) === index) return;
    setBoards([...others.slice(0, index), board, ...others.slice(index)]);
    try {
      const afterId = index === 0 ? null : others[index - 1]!.id;
      setBoards(await api<Board[]>(`/api/boards/${board.id}/move`, { method: "POST", body: { afterId } }));
    } catch (err) {
      handleError(err);
      refreshBoards();
    }
  }

  if (loadError) return <p className="p-8 text-sm text-red-600">{loadError}</p>;
  if (!me || !boards) return <p className="p-8 text-sm text-stone-400">Opening your boards…</p>;

  return (
    <div className="flex h-full bg-stone-50 text-stone-800">
      {navOpen && (
        <div className="fixed inset-0 z-30 bg-stone-900/30 md:hidden" onClick={() => setNavOpen(false)} aria-hidden />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 border-r border-stone-200 bg-stone-100 transition-transform md:static md:z-auto
          md:w-60 md:shrink-0 md:translate-x-0 ${navOpen ? "translate-x-0 shadow-xl" : "-translate-x-full"}`}
      >
        <button
          type="button"
          className={`${iconButton} absolute top-3 right-3 md:hidden`}
          aria-label="Close the menu"
          onClick={() => setNavOpen(false)}
        >
          <X className="h-5 w-5" />
        </button>
        <Sidebar
          me={me}
          boards={boards}
          activeId={route.boardId}
          onMoveBoard={(b, i) => void moveBoard(b, i)}
          onDialog={(d) => {
            setNavOpen(false);
            setDialog(d);
          }}
          onNavigate={() => setNavOpen(false)}
        />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {signedOut && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-x-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            Your session has ended. What is on the page stays here;
            <a href={signedOut} target="_blank" rel="noopener" className="font-medium underline">
              sign in again
            </a>
            (in a new tab), then carry on.
          </div>
        )}

        {route.boardId ? (
          <BoardView
            key={route.boardId}
            boardId={route.boardId}
            cardId={route.cardId}
            boards={boards}
            today={today}
            onBoardsChanged={refreshBoards}
            onError={handleError}
            onNotice={info}
            onHelp={() => setDialog("keys")}
            onMenu={() => setNavOpen(true)}
          />
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-stone-200 px-3 py-2 md:hidden">
              <button type="button" className={iconButton} aria-label="Menu" onClick={() => setNavOpen(true)}>
                <Menu className="h-5 w-5" />
              </button>
              <AboutButton className="px-1 font-semibold text-stone-800">Valkyrie</AboutButton>
            </div>
            {boards.length === 0 && (
              <div className="m-auto max-w-sm p-8 text-center">
                <img src="/favicon.svg" alt="" className="mx-auto mb-4 h-12 w-12" />
                <p className="mb-4 text-sm text-stone-600">
                  No boards yet. A board holds lists of cards; move them along as the work goes.
                </p>
                <button type="button" className={primaryButton} onClick={() => setDialog("new-board")}>
                  <Plus className="h-4 w-4" aria-hidden /> Make your first board
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {notice && (
        <div
          role="status"
          className={`fixed bottom-4 left-1/2 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg px-4 py-2 text-sm shadow-lg ${
            notice.tone === "error" ? "bg-red-700 text-white" : "bg-stone-800 text-white"
          }`}
        >
          {notice.text}
        </div>
      )}

      {dialog === "new-board" && (
        <BoardDialog
          boards={boards}
          onSaved={(board) => {
            refreshBoards();
            go({ boardId: board.id, cardId: null });
          }}
          onError={handleError}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "backup" && (
        <BackupDialog onRestored={refreshBoards} onError={handleError} onClose={() => setDialog(null)} />
      )}
      {dialog === "keys" && <KeysDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
