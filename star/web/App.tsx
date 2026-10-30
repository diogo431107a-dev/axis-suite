import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Maximize, Minus, Plus, User } from "lucide-react";
import {
  SignedOutError,
  fetchMe,
  goToSignIn,
  signInUrl,
  watchForSignIn,
  type Me,
} from "@axis-suite/heimdall-client/browser";
import type { Sky } from "../shared/protocol.ts";
import { api, describeError, setPageUser } from "./api.ts";
import { Overview } from "./panel/Overview.tsx";
import { Search } from "./panel/Search.tsx";
import { StarPanel } from "./panel/StarPanel.tsx";
import { freeSpotNear } from "./sky/layout.ts";
import { nameOf } from "./sky/model.ts";
import { Scene, type SceneEvents } from "./sky/scene.ts";
import { SkyStore } from "./sky/store.ts";
import { Sync, type SyncState } from "./sync.ts";
import { AboutButton } from "./ui/About.tsx";

const RELATIONS = [
  "mother",
  "father",
  "brother",
  "sister",
  "son",
  "daughter",
  "wife",
  "husband",
  "partner",
  "grandmother",
  "grandfather",
  "grandson",
  "granddaughter",
  "uncle",
  "aunt",
  "nephew",
  "niece",
  "cousin",
  "mother-in-law",
  "father-in-law",
  "brother-in-law",
  "sister-in-law",
  "son-in-law",
  "daughter-in-law",
  "stepmother",
  "stepfather",
  "stepson",
  "stepdaughter",
  "half-brother",
  "half-sister",
  "godmother",
  "godfather",
  "godson",
  "goddaughter",
  "ex-wife",
  "ex-husband",
  "fiancée",
  "fiancé",
];

/** Below this the panel is a bottom sheet (Tailwind's md, as in the suite's other modules). */
const NARROW = "(max-width: 767px)";
const isNarrow = () => matchMedia(NARROW).matches;

/** Signs in and loads the sky; everything after that is SkyPage's. */
export default function App() {
  const [loaded, setLoaded] = useState<{ me: Me; sky: Sky } | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then(async (me) => {
        setPageUser(me.username);
        const sky = await api<Sky>("/api/sky");
        if (!cancelled) setLoaded({ me, sky });
      })
      .catch((err: unknown) => {
        if (err instanceof SignedOutError) goToSignIn(err);
        else if (!cancelled) setLoadError("Could not load your sky. Try again in a moment.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loaded) return <SkyPage me={loaded.me} initial={loaded.sky} />;
  return (
    <div id="app">
      <div className="screen" role={loadError ? "alert" : "status"}>
        {loadError || "Finding your sky…"}
      </div>
    </div>
  );
}

function SkyPage({ me, initial }: { me: Me; initial: Sky }) {
  const [notice, setNotice] = useState("");
  const [saveState, setSaveState] = useState<SyncState>("saved");
  // Set when the session ends mid-use. Holds the sign-in URL.
  const [signedOut, setSignedOut] = useState<string | null>(null);

  const [{ store, sync }] = useState(() => {
    const sync = new Sync({
      saved: (rev) => {
        store.rev = rev;
      },
      state: setSaveState,
      refused: (message) => {
        setNotice(`${message}. Showing your sky as it was last saved.`);
        void api<Sky>("/api/sky")
          .then((sky) => store.load(sky))
          .catch((err: unknown) => setNotice(describeError(err)));
      },
      signedOut: setSignedOut,
    });
    const store = new SkyStore((op) => sync.push(op));
    store.load(initial);
    return { store, sync };
  });
  useSyncExternalStore(
    useCallback((listener: () => void) => store.subscribe(listener), [store]),
    () => store.version,
  );

  const [selected, setSelected] = useState<string | null>(null);
  const [focusNameOf, setFocusNameOf] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [connectProblem, setConnectProblem] = useState("");
  const [pending, setPending] = useState<{ a: string; b: string } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(isNarrow);

  const sceneRef = useRef<Scene | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const fieldRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  const star = selected !== null ? store.index.byId.get(selected) : undefined;

  const select = (id: string | null, keepPending = false) => {
    setSelected(id);
    if (!keepPending) setPending(null);
    if (id !== null && isNarrow()) setCollapsed(false);
  };

  /** Flies once the page has been drawn: on a narrow window, selecting opens the sheet over the sky. */
  const flyLater = (id: string) => {
    requestAnimationFrame(() => sceneRef.current?.flyTo(id));
  };

  const go = (id: string) => {
    select(id);
    flyLater(id);
  };

  /** A new star appears with a little bloom. */
  const bloom = (id: string) => {
    setFlash(id);
    setTimeout(() => setFlash((current) => (current === id ? null : current)), 800);
  };

  const createMain = (x: number, y: number) => {
    const s = store.addMain(x, y);
    bloom(s.id);
    setFocusNameOf(s.id);
    select(s.id);
    return s;
  };

  const endConnect = () => {
    setConnectFrom(null);
    setConnectProblem("");
  };

  const startConnect = (id: string) => {
    setConnectFrom(id);
    setConnectProblem("");
    setPending(null);
    if (isNarrow()) setCollapsed(true);
  };

  const completeConnect = (from: string, target: string) => {
    const a = store.index.byId.get(from);
    const b = store.index.byId.get(target);
    if (!a || !b || a === b) return;
    if (b.parent === a.id || a.parent === b.id) {
      setConnectProblem(`${nameOf(b)} is already tied to ${nameOf(a)}. Pick another star.`);
      return;
    }
    const taken = store.links.some((l) => (l.a === a.id && l.b === b.id) || (l.a === b.id && l.b === a.id));
    if (taken) {
      setConnectProblem("These two are already connected. Pick another star.");
      return;
    }
    endConnect();
    setPending({ a: a.id, b: b.id });
    select(a.id, true);
  };

  // The scene lives as long as the page, and calls whatever the latest render's handlers are.
  const sceneEvents = useRef<SceneEvents | null>(null);
  useEffect(() => {
    sceneEvents.current = {
      starClicked: (id) => {
        if (connectFrom !== null) completeConnect(connectFrom, id);
        else if (isNarrow()) go(id);
        else select(id);
      },
      skyClicked: () => {
        if (connectFrom === null && selected !== null) select(null);
      },
      skyDoubleClicked: (x, y) => {
        if (connectFrom === null) createMain(x, y);
      },
    };
  });

  useEffect(() => {
    const scene = new Scene(
      store,
      {
        svg: svgRef.current!,
        field: fieldRef.current!,
        tip: tipRef.current!,
        bar: () => barRef.current,
        panel: () => panelRef.current,
      },
      {
        starClicked: (id) => sceneEvents.current?.starClicked(id),
        skyClicked: () => sceneEvents.current?.skyClicked(),
        skyDoubleClicked: (x, y) => sceneEvents.current?.skyDoubleClicked(x, y),
      },
    );
    sceneRef.current = scene;
    return () => {
      scene.destroy();
      sceneRef.current = null;
    };
  }, [store]);

  useEffect(() => {
    sceneRef.current?.setMarks({ selected, connectFrom, flash });
  }, [selected, connectFrom, flash]);

  useEffect(() => {
    const query = matchMedia(NARROW);
    const changed = () => {
      setCollapsed(query.matches && selected === null);
      sceneRef.current?.fit();
    };
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, [selected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector("dialog[open]")) return;
      if (connectFrom !== null) {
        endConnect();
      } else if (selected !== null && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName ?? "")) {
        select(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // Leaving the page: save what is waiting, and warn if something still can't be saved.
  useEffect(() => {
    const leaving = () => {
      if (document.visibilityState !== "hidden") return;
      store.savePositions();
      sync.flush(true);
    };
    const warn = (e: BeforeUnloadEvent) => {
      if (!sync.idle) e.preventDefault();
    };
    document.addEventListener("visibilitychange", leaving);
    window.addEventListener("pagehide", leaving);
    window.addEventListener("beforeunload", warn);
    return () => {
      document.removeEventListener("visibilitychange", leaving);
      window.removeEventListener("pagehide", leaving);
      window.removeEventListener("beforeunload", warn);
    };
  }, [store, sync]);

  // Coming back to the tab: the sky may have changed in another tab or on another device.
  useEffect(() => {
    const refresh = () => {
      if (!sync.idle) return;
      api<Sky>("/api/sky")
        .then((sky) => {
          if (sync.idle && sky.rev !== store.rev) store.load(sky);
        })
        .catch((err: unknown) => {
          if (err instanceof SignedOutError) setSignedOut(signInUrl(err.loginUrl));
        });
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [store, sync]);

  // While signed out, check again whenever the user comes back to this tab (e.g. after signing
  // in from the notice's link). Someone else signing in gets a fresh page.
  useEffect(() => {
    if (!signedOut) return;
    return watchForSignIn(me.username, () => {
      setSignedOut(null);
      sync.resume();
    });
  }, [signedOut, me.username, sync]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const onHeadClick = (target: EventTarget) => {
    if (isNarrow() && !(target as Element).closest("button")) setCollapsed((c) => !c);
  };

  const connectName = connectFrom !== null ? store.index.byId.get(connectFrom) : undefined;

  return (
    <div id="app">
      <canvas id="field" ref={fieldRef} aria-hidden="true" />
      <svg id="sky" ref={svgRef} role="application" aria-label="Constellations of the people you know" />

      <header className="bar" ref={barRef}>
        <div className="brand">
          <h1>
            <AboutButton>
              <img src="/favicon.svg" alt="" />
              Every Man is a Star
            </AboutButton>
          </h1>
        </div>
        <Search store={store} onPick={go} />
        <div className="tools">
          <button
            className="btn gold"
            type="button"
            onClick={() => {
              const scene = sceneRef.current;
              if (!scene) return;
              const centre = scene.visibleCentre();
              const spot = freeSpotNear(store.stars, centre.x, centre.y);
              flyLater(createMain(spot.x, spot.y).id);
            }}
          >
            + Someone I know
          </button>
          <a className="btn account" href={me.accountUrl} title="Your Heimdall account, where you sign out">
            <User aria-hidden />
            <span>{me.name}</span>
          </a>
        </div>
      </header>

      {connectName && (
        <div className="banner">
          <span>
            {connectProblem || (
              <>
                Pick the star related to <b>{nameOf(connectName)}</b>
              </>
            )}
          </span>
          <button className="btn sm ghost" type="button" onClick={endConnect}>
            Cancel
          </button>
        </div>
      )}

      {signedOut && (
        <div className="notice top bad" role="alert">
          <span>
            Your session has ended. Your changes wait on this page;{" "}
            <a href={signedOut} target="_blank" rel="noopener">
              sign in again
            </a>{" "}
            (in a new tab), then carry on.
          </span>
        </div>
      )}
      {!signedOut && saveState === "unsaved" && !sync.idle && notice === "" && <Unsaved sync={sync} />}
      {notice && (
        <div className="notice bad" role="alert">
          {notice}
        </div>
      )}

      <div className="zoom">
        <button type="button" aria-label="Zoom in" onClick={() => sceneRef.current?.zoomBy(1.25)}>
          <Plus aria-hidden />
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => sceneRef.current?.zoomBy(1 / 1.25)}>
          <Minus aria-hidden />
        </button>
        <button type="button" aria-label="Show the whole sky" onClick={() => sceneRef.current?.fit()}>
          <Maximize aria-hidden />
        </button>
      </div>

      <aside className={`panel${collapsed ? " collapsed" : ""}`} ref={panelRef} aria-live="polite">
        {star ? (
          <StarPanel
            key={star.id}
            store={store}
            star={star}
            focusName={focusNameOf === star.id}
            pendingWith={pending?.a === star.id ? pending.b : null}
            onGo={go}
            onClose={() => select(null)}
            onToggleSheet={() => setCollapsed((c) => !c)}
            onHeadClick={onHeadClick}
            onAddRelative={(name, relation) => {
              const child = store.addRelative(star.id, name, relation);
              bloom(child.id);
              sceneRef.current?.kick(0.9);
            }}
            onStartConnect={() => startConnect(star.id)}
            onConnect={(relation) => {
              if (pending) store.addLink(pending.a, pending.b, relation);
              setPending(null);
              sceneRef.current?.kick(0.5);
            }}
            onCancelPending={() => setPending(null)}
            onUnlink={(id) => {
              store.removeLink(id);
              sceneRef.current?.kick(0.4);
            }}
            onPromote={() => {
              store.promote(star.id);
              sceneRef.current?.kick(0.8);
            }}
            onRemove={() => {
              store.remove(star.id);
              select(null);
              sceneRef.current?.kick(0.5);
            }}
            onBlurField={() => sync.flush()}
          />
        ) : (
          <Overview store={store} onGo={go} onToggleSheet={() => setCollapsed((c) => !c)} onHeadClick={onHeadClick} />
        )}
      </aside>

      <div className="tip" ref={tipRef} hidden />

      <datalist id="rels">
        {RELATIONS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
    </div>
  );
}

/** Says so only if saving takes a while: a normal save is over before anyone could read this. */
function Unsaved({ sync }: { sync: Sync }) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLate(true), 4000);
    return () => clearTimeout(timer);
  }, []);
  if (!late || sync.idle) return null;
  return (
    <div className="notice" role="status">
      Not saved yet. Star keeps trying, so leave this page open.
    </div>
  );
}
