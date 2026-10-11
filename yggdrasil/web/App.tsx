import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CircleCheck, PanelLeft, UserRound } from "lucide-react";
import { SignedOutError, fetchMe, goToSignIn, watchForSignIn, type Me } from "@axis-suite/heimdall-client/browser";
import { importFile } from "./io/importer.ts";
import { Outliner } from "./model/outliner.ts";
import { ExportDialog } from "./outline/ExportDialog.tsx";
import { OutlinerContext, useNode, useOutliner, useSyncState, useView } from "./outline/hooks.ts";
import { focusSearch, zoomFromLocation, zoomTo } from "./outline/nav.ts";
import { Outline } from "./outline/Outline.tsx";
import { SearchBox } from "./outline/SearchBox.tsx";
import { Sidebar } from "./outline/Sidebar.tsx";
import { plainText } from "./text/plain.ts";

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [outliner, setOutliner] = useState<Outliner | null>(null);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = async (attempt: number) => {
      try {
        const user = await fetchMe();
        const o = new Outliner(user.username, { notice: setNotice });
        o.ui.setView({ zoom: zoomFromLocation() });
        await o.sync.start();
        if (cancelled) return;
        setMe(user);
        setOutliner(o);
      } catch (e) {
        if (e instanceof SignedOutError) return goToSignIn(e);
        // The server may be restarting: keep trying, less and less often.
        setLoadError("Can’t reach Yggdrasil right now. Trying again…");
        if (!cancelled) retry = setTimeout(() => void load(attempt + 1), Math.min(30_000, 1000 * 2 ** attempt));
      }
    };
    void load(0);
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, []);

  // Back and Forward move between zoomed-in bullets.
  useEffect(() => {
    if (!outliner) return;
    const onPop = () => {
      outliner.ui.clearSelection();
      outliner.ui.setView({ zoom: zoomFromLocation() });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [outliner]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  if (!me || !outliner) {
    return (
      <div className="flex h-screen items-center justify-center bg-white text-sm text-gray-400">
        {loadError || "Loading…"}
      </div>
    );
  }

  return (
    <OutlinerContext.Provider value={outliner}>
      <Page me={me} notice={notice} />
    </OutlinerContext.Provider>
  );
}

function Page({ me, notice }: { me: Me; notice: string }) {
  const o = useOutliner();
  const sync = useSyncState();
  const { zoom, showCompleted } = useView();
  const root = useNode(zoom);
  const signedOut = sync.kind === "signedOut" ? sync.loginUrl : null;
  // On narrow screens the sidebar opens over the outline.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const dialog = useSyncExternalStore(
    useCallback((cb: () => void) => o.ui.subscribe(cb), [o]),
    () => o.ui.dialog,
  );
  const closeDialog = useCallback(() => o.ui.setDialog(null), [o]);

  // Ctrl+F searches the outline rather than the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        focusSearch();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Each time the user comes back to this tab, check who is signed in: after signing in again
  // from the banner's link, the waiting changes go out; if someone else signed in, the page
  // starts over with their tree.
  useEffect(
    () =>
      watchForSignIn(me.username, () => {
        if (o.sync.state.kind === "signedOut") o.sync.resume();
      }),
    [me.username, o],
  );

  useEffect(() => {
    document.title = root ? `${plainText(root.content) || "Untitled"} · Yggdrasil` : "Yggdrasil";
  }, [root]);

  return (
    <div className="min-h-screen bg-white text-[15px] leading-[1.6] text-gray-800">
      {signedOut && (
        <div role="alert" className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-800">
          Your session has ended, so changes can’t be saved right now. They are kept here.{" "}
          <a href={signedOut} target="_blank" rel="noopener" className="font-medium underline">
            Sign in again
          </a>{" "}
          (opens a new tab), then come back here.
        </div>
      )}
      <header className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-gray-100 bg-white/95 px-3 backdrop-blur">
        <button
          type="button"
          aria-label="Show the sidebar"
          onClick={() => setSidebarOpen((v) => !v)}
          className="rounded p-1 text-gray-500 hover:bg-gray-100 md:hidden"
        >
          <PanelLeft className="h-5 w-5" />
        </button>
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            zoomTo(o, null);
          }}
          className="hidden font-semibold tracking-tight text-green-800 sm:block md:w-52"
        >
          Yggdrasil
        </a>
        <div className="flex min-w-0 flex-1 justify-center">
          <SearchBox />
        </div>
        <button
          type="button"
          aria-pressed={showCompleted}
          title={showCompleted ? "Hide completed bullets" : "Show completed bullets"}
          onClick={() => o.ui.setView({ showCompleted: !showCompleted })}
          className={`flex items-center gap-1 rounded px-1.5 py-1 text-xs hover:bg-gray-100 ${
            showCompleted ? "text-green-800" : "text-gray-400"
          }`}
        >
          <CircleCheck className="h-4 w-4" />
          <span className="hidden lg:inline">{showCompleted ? "Completed shown" : "Completed hidden"}</span>
        </button>
        <SyncStatus />
        <a
          href={me.accountUrl}
          title={`Signed in as ${me.username}. Manage your session.`}
          className="flex items-center gap-1 truncate text-xs text-gray-400 transition-colors hover:text-green-800"
        >
          <UserRound className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden truncate sm:inline">{me.name}</span>
        </a>
      </header>
      {notice && (
        <div
          role="status"
          className="fixed left-1/2 top-14 z-20 -translate-x-1/2 rounded-md bg-gray-800 px-4 py-2 text-sm text-white shadow"
        >
          {notice}
        </div>
      )}
      <div className="flex">
        <aside
          className={`${sidebarOpen ? "fixed inset-y-12 left-0 z-10 block bg-white shadow-lg" : "hidden"}
                      w-64 shrink-0 overflow-y-auto border-r border-gray-100 md:sticky md:top-12 md:block
                      md:h-[calc(100vh-3rem)] md:shadow-none`}
        >
          <Sidebar onPick={() => setSidebarOpen(false)} />
        </aside>
        <main
          className={`mx-auto min-w-0 max-w-3xl flex-1 px-4 pt-6 ${dropping ? "rounded-lg outline-2 outline-dashed outline-green-600" : ""}`}
          // An OPML file dropped on the outline is imported into the zoomed-in bullet.
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDropping(true);
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={(e) => {
            const file = e.dataTransfer.files[0];
            setDropping(false);
            if (!file) return;
            e.preventDefault();
            void importFile(o, file);
          }}
        >
          <Outline />
        </main>
      </div>
      <SaveProgress />
      {dialog?.kind === "export" && <ExportDialog root={dialog.root} onClose={closeDialog} />}
    </div>
  );
}

function SyncStatus() {
  const sync = useSyncState();
  const text =
    sync.kind === "saved"
      ? "Saved"
      : sync.kind === "saving"
        ? "Saving…"
        : sync.kind === "offline"
          ? `Offline — ${sync.waiting} ${sync.waiting === 1 ? "change" : "changes"} waiting`
          : `Signed out — ${sync.waiting} waiting`;
  const color = sync.kind === "offline" || sync.kind === "signedOut" ? "text-amber-700" : "text-gray-400";
  return (
    <span role="status" className={`text-xs ${color}`}>
      {text}
    </span>
  );
}

/** A progress bar while many changes are on their way to the server (an import, say). */
function SaveProgress() {
  const sync = useSyncState();
  const waiting = sync.kind === "saved" ? 0 : sync.waiting;
  const total = useRef(0);
  if (waiting === 0) total.current = 0;
  else total.current = Math.max(total.current, waiting);
  if (total.current < 1000) return null;
  const done = total.current - waiting;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total.current}
      aria-valuenow={done}
      className="fixed bottom-4 left-1/2 z-30 w-72 -translate-x-1/2 rounded-md bg-white p-3 text-xs text-gray-600 shadow-lg ring-1 ring-gray-200"
    >
      <div className="mb-1.5">
        {sync.kind === "offline" ? "Offline — " : "Saving "}
        {done.toLocaleString()} of {total.current.toLocaleString()} changes
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-gray-100">
        <div className="h-full bg-green-600 transition-all" style={{ width: `${(100 * done) / total.current}%` }} />
      </div>
    </div>
  );
}
