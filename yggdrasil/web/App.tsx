import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { SignedOutError, fetchMe, goToSignIn, watchForSignIn, type Me } from "@axis-suite/heimdall-client/browser";
import { Outliner } from "./model/outliner.ts";
import { OutlinerContext, useNode, useOutliner, useSyncState, useView } from "./outline/hooks.ts";
import { zoomFromLocation, zoomTo } from "./outline/nav.ts";
import { Outline } from "./outline/Outline.tsx";
import { plainText } from "./text/plain.ts";

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [outliner, setOutliner] = useState<Outliner | null>(null);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const user = await fetchMe();
      const o = new Outliner(user.username, { notice: setNotice });
      o.ui.setView({ zoom: zoomFromLocation() });
      await o.sync.start();
      if (cancelled) return;
      setMe(user);
      setOutliner(o);
    })().catch((e) => {
      if (e instanceof SignedOutError) goToSignIn(e);
      else setLoadError("Could not load your outline. Try again in a moment.");
    });
    return () => {
      cancelled = true;
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
  const { zoom } = useView();
  const root = useNode(zoom);
  const signedOut = sync.kind === "signedOut" ? sync.loginUrl : null;

  // While signed out, check again whenever the user comes back to this tab (e.g. after signing
  // in from the banner's link). Someone else signing in gets a fresh page.
  useEffect(() => {
    if (!signedOut) return;
    return watchForSignIn(me.username, () => o.sync.resume());
  }, [signedOut, me.username, o]);

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
      <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-gray-100 bg-white/95 px-4 py-2 backdrop-blur">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            zoomTo(o, null);
          }}
          className="font-semibold tracking-tight text-green-800"
        >
          Yggdrasil
        </a>
        <div className="flex-1" />
        <SyncStatus />
        <a
          href={me.accountUrl}
          title={`Signed in as ${me.username}. Manage your session.`}
          className="flex items-center gap-1 truncate text-xs text-gray-400 transition-colors hover:text-green-800"
        >
          <UserRound className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{me.name}</span>
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
      <main className="mx-auto max-w-3xl px-4 pt-6">
        <Outline />
      </main>
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
