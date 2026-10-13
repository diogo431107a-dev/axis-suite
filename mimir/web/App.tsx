import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Menu, Plus, X } from "lucide-react";
import {
  SignedOutError,
  fetchMe,
  goToSignIn,
  signInUrl,
  watchForSignIn,
  type Me,
} from "@axis-suite/heimdall-client/browser";
import type { MapData, MapSummary, RestoreResult } from "../shared/protocol.ts";
import { Sidebar, type SidebarDialog } from "./Sidebar.tsx";
import { api, describeError, setPageUser } from "./api.ts";
import { BackupDialog } from "./dialogs/BackupDialog.tsx";
import { KeysDialog } from "./dialogs/KeysDialog.tsx";
import { leftOut, opmlAsBackup, tooBig } from "./io/importer.ts";
import { OpmlError, parseOpml } from "./io/opml.ts";
import { MapView } from "./map/MapView.tsx";
import { Sync } from "./model/sync.ts";
import { go, useRoute } from "./nav.ts";
import { iconButton, primaryButton } from "./ui/buttons.ts";

interface Notice {
  text: string;
  tone: "info" | "error";
}

/** The map opened last on this device, for "/". */
const LAST_MAP = "mimir:last-map";

function lastMap(): string | null {
  try {
    return localStorage.getItem(LAST_MAP);
  } catch {
    return null;
  }
}

function rememberMap(id: string): void {
  try {
    localStorage.setItem(LAST_MAP, id);
  } catch {
    // Not remembered; "/" opens the first map instead.
  }
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState("");
  const [maps, setMaps] = useState<MapSummary[] | null>(null);
  const [dialog, setDialog] = useState<SidebarDialog | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Set when the session ends mid-use. Holds the sign-in URL.
  const [signedOut, setSignedOut] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** A map just made: it opens with its centre being written. */
  const [fresh, setFresh] = useState<string | null>(null);
  const route = useRoute();
  const onReloaded = useRef<(() => void) | null>(null);

  const handleError = useCallback((err: unknown) => {
    if (err instanceof SignedOutError) setSignedOut(signInUrl(err.loginUrl));
    else setNotice({ text: describeError(err), tone: "error" });
  }, []);
  const say = useCallback((text: string, tone: "info" | "error" = "info") => setNotice({ text, tone }), []);

  const reloadMaps = useCallback(async () => {
    setMaps(await api<MapSummary[]>("/api/maps"));
  }, []);
  const refreshMaps = useCallback(() => void reloadMaps().catch(handleError), [reloadMaps, handleError]);

  // One save queue for the whole page, made once the user is known.
  const sync = useMemo(
    () =>
      me
        ? new Sync(me.username, {
            notice: (text) => setNotice({ text, tone: "error" }),
            reloaded: () => onReloaded.current?.(),
            gone: () => {
              setNotice({ text: "That map was deleted elsewhere.", tone: "error" });
              refreshMaps();
            },
          })
        : null,
    [me, refreshMaps],
  );
  useEffect(() => sync?.start(), [sync]);

  // The save queue's sign-out shows the same banner as any other request's.
  useEffect(() => {
    if (!sync) return;
    return sync.subscribe(() => {
      if (sync.state.kind === "signedOut") setSignedOut(sync.state.loginUrl);
    });
  }, [sync]);

  useEffect(() => {
    fetchMe()
      .then(async (user) => {
        setPageUser(user.username);
        setMe(user);
        await reloadMaps();
      })
      .catch((err: unknown) => {
        if (err instanceof SignedOutError) goToSignIn(err);
        else setLoadError("Could not load your maps. Try again in a moment.");
      });
  }, [reloadMaps]);

  // While signed out, check again whenever the user comes back to this tab (e.g. after signing
  // in from the banner's link). Someone else signing in gets a fresh page.
  useEffect(() => {
    if (!signedOut || !me) return;
    return watchForSignIn(me.username, () => {
      setSignedOut(null);
      sync?.resume();
      refreshMaps();
    });
  }, [signedOut, me, sync, refreshMaps]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  // "/" opens the map opened last here, or the first one.
  useEffect(() => {
    if (!maps || route.mapId) return;
    const last = lastMap();
    const target = maps.find((m) => m.id === last) ?? maps[0];
    if (target) go({ mapId: target.id, nodeId: null }, true);
  }, [maps, route.mapId]);

  useEffect(() => {
    if (route.mapId) rememberMap(route.mapId);
  }, [route.mapId]);

  const current = maps?.find((m) => m.id === route.mapId);
  useEffect(() => {
    document.title = current ? `${current.name} · Mimir` : "Mimir";
  }, [current]);

  // ? anywhere but in a field or the map (which has its own): the keyboard keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if ((e.target as HTMLElement).closest("input, textarea, select, dialog, [contenteditable], [role=application]")) {
        return;
      }
      e.preventDefault();
      setDialog("keys");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function newMap() {
    setBusy(true);
    try {
      const data = await api<MapData>("/api/maps", { method: "POST", body: {} });
      setMaps((list) => [...(list ?? []), data.map]);
      setFresh(data.map.id);
      setNavOpen(false);
      go({ mapId: data.map.id, nodeId: null });
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  }

  async function importMap(file: File) {
    setBusy(true);
    try {
      const parsed = parseOpml(await file.text());
      const big = tooBig(parsed);
      if (big) return say(big, "error");
      const r = await api<RestoreResult>("/api/restore", { method: "POST", body: opmlAsBackup(parsed, file.name) });
      await reloadMaps();
      setNavOpen(false);
      if (r.ids[0]) go({ mapId: r.ids[0], nodeId: null });
      say(`Imported ${file.name}.${leftOut(parsed)}`);
    } catch (err) {
      if (err instanceof OpmlError) say(`${file.name}: ${err.message}`, "error");
      else handleError(err);
    } finally {
      setBusy(false);
    }
  }

  async function moveMap(map: MapSummary, index: number) {
    if (!maps) return;
    const others = maps.filter((m) => m.id !== map.id);
    if (maps.indexOf(map) === index) return;
    setMaps([...others.slice(0, index), map, ...others.slice(index)]);
    try {
      const afterId = index === 0 ? null : others[index - 1]!.id;
      setMaps(await api<MapSummary[]>(`/api/maps/${map.id}/move`, { method: "POST", body: { afterId } }));
    } catch (err) {
      handleError(err);
      refreshMaps();
    }
  }

  if (loadError) return <p className="p-8 text-sm text-red-600">{loadError}</p>;
  if (!me || !maps || !sync) return <p className="p-8 text-sm text-stone-400">Opening your maps…</p>;

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
          maps={maps}
          activeId={route.mapId}
          busy={busy}
          onNewMap={() => void newMap()}
          onImport={(file) => void importMap(file)}
          onMoveMap={(m, i) => void moveMap(m, i)}
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
            Your session has ended. Your changes wait on this page;
            <a href={signedOut} target="_blank" rel="noopener" className="font-medium underline">
              sign in again
            </a>
            (in a new tab), then carry on.
          </div>
        )}

        {route.mapId ? (
          <MapView
            key={route.mapId}
            mapId={route.mapId}
            nodeId={route.nodeId}
            username={me.username}
            sync={sync}
            fresh={fresh === route.mapId}
            onRenamed={(id, name) => setMaps((list) => list?.map((m) => (m.id === id ? { ...m, name } : m)) ?? list)}
            onDeleted={(id) => {
              setMaps((list) => list?.filter((m) => m.id !== id) ?? list);
              go({ mapId: null, nodeId: null }, true);
              say("Map deleted.");
            }}
            onMissing={() => refreshMaps()}
            onNotice={say}
            onError={handleError}
            onHelp={() => setDialog("keys")}
            onMenu={() => setNavOpen(true)}
            onReloadedRef={onReloaded}
          />
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-stone-200 px-3 py-2 md:hidden">
              <button type="button" className={iconButton} aria-label="Menu" onClick={() => setNavOpen(true)}>
                <Menu className="h-5 w-5" />
              </button>
              <span className="font-semibold text-stone-800">Mimir</span>
            </div>
            {maps.length === 0 && (
              <div className="m-auto max-w-sm p-8 text-center">
                <img src="/favicon.svg" alt="" className="mx-auto mb-4 h-12 w-12" />
                <p className="mb-4 text-sm text-stone-600">
                  No maps yet. A map starts from one idea in the middle and branches out to both sides.
                </p>
                <button type="button" className={primaryButton} disabled={busy} onClick={() => void newMap()}>
                  <Plus className="h-4 w-4" aria-hidden /> Make your first map
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

      {dialog === "backup" && (
        <BackupDialog onRestored={() => refreshMaps()} onError={handleError} onClose={() => setDialog(null)} />
      )}
      {dialog === "keys" && <KeysDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
