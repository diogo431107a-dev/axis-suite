import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SignedOutError,
  fetchMe,
  goToSignIn,
  signInUrl,
  watchForSignIn,
  type Me,
} from "@axis-suite/heimdall-client/browser";
import type { Dossier, Source } from "../shared/protocol.ts";
import { letterOf } from "../shared/time.ts";
import { api, describeError, setPageUser, setSignedOutHandler } from "./api.ts";
import { Drawer } from "./Drawer.tsx";
import { FileView, NoFile } from "./file/FileView.tsx";
import { AnswerForm } from "./forms/AnswerForm.tsx";
import { DetailsForm } from "./forms/DetailsForm.tsx";
import { EntryForm } from "./forms/EntryForm.tsx";
import { Muninn } from "./forms/Muninn.tsx";
import { Index } from "./model.ts";
import { PageProvider, type Page, type Sheet, type Ui, type View } from "./page.ts";
import { isoDate } from "./time.ts";
import { AboutButton } from "./ui/About.tsx";
import { Places } from "./views/Places.tsx";
import { Search } from "./views/Search.tsx";
import { Threads } from "./views/Threads.tsx";

const ALL_SOURCES: Source[] = ["U", "I", "P", "O", "N"];
const NARROW = 820;

const NAV: [View, string][] = [
  ["file", "Drawer"],
  ["threads", "Threads"],
  ["places", "Places"],
  ["search", "Search"],
];

const FIRST_UI: Ui = {
  view: "file",
  pid: null,
  tab: "profile",
  ledger: "spont",
  life: "ours",
  order: "told",
  srcf: new Set<Source>(["U", "I", "O", "N"]),
  open: new Set(),
  flash: null,
  showClosed: false,
  q: "",
  qsrc: new Set(ALL_SOURCES),
  qplace: "",
  place: null,
  expanded: new Set(),
};

/** Signs in and loads the drawer; everything after that is DossierPage's. */
export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((user) => {
        setPageUser(user.username);
        if (!cancelled) setMe(user);
      })
      .catch((err: unknown) => {
        if (err instanceof SignedOutError) goToSignIn(err);
        else if (!cancelled) setLoadError("Could not open the drawer. Try again in a moment.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (me) return <DossierPage me={me} />;
  return (
    <div className="screen" role={loadError ? "alert" : "status"}>
      {loadError || "Opening the drawer…"}
    </div>
  );
}

function DossierPage({ me }: { me: Me }) {
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [ui, setUi] = useState<Ui>(FIRST_UI);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [notice, setNotice] = useState("");
  const [toastText, setToastText] = useState("");
  // Set when the session ends mid-use. Holds the sign-in URL.
  const [signedOut, setSignedOut] = useState<string | null>(null);
  const paneRef = useRef<HTMLElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const load = useCallback(async () => {
    setDossier(await api<Dossier>("/api/dossier"));
    setNotice("");
  }, []);

  const refresh = useCallback(() => {
    load().catch((err: unknown) => setNotice(describeError(err)));
  }, [load]);

  useEffect(refresh, [refresh]);

  // Catches up with changes made elsewhere (another tab or device). An open form keeps what is typed.
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  useEffect(() => {
    setSignedOutHandler(setSignedOut);
  }, []);
  useEffect(() => {
    if (!signedOut) return;
    return watchForSignIn(me.username, () => {
      setSignedOut(null);
      refresh();
    });
  }, [signedOut, me.username, refresh]);

  // A new entry to show: into view, lit up for a moment.
  useEffect(() => {
    if (!ui.flash) return;
    const flash = ui.flash;
    const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frame = requestAnimationFrame(() => {
      document.getElementById(`en-${flash}`)?.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
    });
    const timer = setTimeout(() => setUi((u) => (u.flash === flash ? { ...u, flash: null } : u)), 1700);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [ui.flash]);

  const ix = useMemo(() => (dossier ? new Index(dossier) : null), [dossier]);
  const today = isoDate();

  // Opening a file unfolds its own letter, once; after that the letter is the user's to fold.
  const openName = ix?.person(ui.pid)?.name;
  const unfolded = useRef<string | null>(null);
  useEffect(() => {
    if (ui.pid === unfolded.current || !openName) return;
    unfolded.current = ui.pid;
    setUi((u) => ({ ...u, expanded: new Set([...u.expanded, letterOf(openName)]) }));
  }, [ui.pid, openName]);

  const page = useMemo<Page | null>(() => {
    if (!ix) return null;
    const patch = (change: Partial<Ui>) => setUi((u) => ({ ...u, ...change }));
    const toast = (message: string) => {
      setToastText(message);
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToastText(""), 3200);
    };
    const send: Page["send"] = async (path, method, body) => {
      await api(path, { method, body });
      await load();
    };
    return {
      ix,
      today,
      ui,
      patch,
      setSheet,
      send,
      toast,
      act: (path, method, body, done) => {
        send(path, method, body)
          .then(() => {
            if (done) toast(done);
          })
          .catch((err: unknown) => toast(describeError(err)));
      },
      openFile: (pid, tab = "profile") => {
        setUi((u) => ({ ...u, view: "file", pid, tab, open: new Set() }));
        paneRef.current?.scrollTo(0, 0);
      },
      gotoEntry: (eid) => {
        const entry = ix.entry(eid);
        if (!entry) return;
        setSheet(null);
        setUi((u) => ({
          ...u,
          view: "file",
          pid: entry.person,
          tab: "timeline",
          ledger: entry.src === "P" ? "prompt" : "spont",
          life: "ours",
          srcf: entry.src === "P" ? u.srcf : new Set([...u.srcf, entry.src]),
          open: new Set([...u.open, eid]),
          flash: eid,
        }));
      },
      showSaved: (pid, eid, src, expand) => {
        setUi((u) => ({
          ...u,
          view: "file",
          pid,
          tab: "timeline",
          ledger: src === "P" ? "prompt" : "spont",
          life: "ours",
          srcf: src === "P" ? u.srcf : new Set([...u.srcf, src]),
          open: expand ? new Set([eid]) : new Set(),
          flash: eid,
        }));
      },
    };
  }, [ix, today, ui, load]);

  if (!page || !ix) {
    return (
      <div className="screen" role={notice ? "alert" : "status"}>
        {notice || "Opening the drawer…"}
      </div>
    );
  }

  const overdue = ix.overdueCount(today);
  const openPerson = ix.person(ui.pid);
  const showingPane = ui.view !== "file" || !!openPerson;
  const banner = signedOut || notice;

  return (
    <PageProvider value={page}>
      <div className={`app ${showingPane ? "show-pane" : ""} ${banner ? "has-banner" : ""}`}>
        <header className="bar">
          <div className="brand">
            <AboutButton>
              <span className="mark">TYR</span>
            </AboutButton>
            <span className="tagline">What was said, when, and where.</span>
          </div>
          <nav className="nav" aria-label="Views">
            {NAV.map(([view, label]) => (
              <button
                key={view}
                type="button"
                aria-current={ui.view === view}
                onClick={() => {
                  page.patch(view === "file" && window.innerWidth <= NARROW ? { view, pid: null } : { view });
                  paneRef.current?.scrollTo(0, 0);
                }}
              >
                {label}
                {view === "threads" && overdue > 0 && <span className="count">{overdue}</span>}
              </button>
            ))}
          </nav>
          <button
            type="button"
            className="btn capture-btn"
            title="Quick capture"
            onClick={() => setSheet({ what: "muninn", tab: "capture" })}
          >
            Muninn <span className="k">quick capture</span>
          </button>
          <a className="who" href={me.accountUrl}>
            {me.name}
          </a>
        </header>
        {signedOut && (
          <p className="banner" role="alert">
            Your session has ended.{" "}
            <a href={signInUrl(signedOut)} target="_blank" rel="noreferrer">
              Sign in again in a new tab
            </a>
            , then come back. Nothing you typed is lost.
          </p>
        )}
        {notice && !signedOut && (
          <p className="banner" role="alert">
            {notice}
          </p>
        )}
        <main className="panes">
          <Drawer />
          <section id="pane" ref={paneRef} aria-live="polite">
            {ui.view === "file" && (openPerson ? <FileView key={openPerson.id} person={openPerson} /> : <NoFile />)}
            {ui.view === "threads" && <Threads />}
            {ui.view === "places" && <Places />}
            {ui.view === "search" && <Search />}
          </section>
        </main>
      </div>
      {sheet?.what === "entry" && <EntryForm key={sheetKey(sheet)} sheet={sheet} />}
      {sheet?.what === "muninn" && <Muninn tab={sheet.tab} name={sheet.name} />}
      {sheet?.what === "answer" && <AnswerForm pid={sheet.pid} q={sheet.q} />}
      {sheet?.what === "details" && <DetailsForm pid={sheet.pid} />}
      {toastText && (
        <div id="toast" role="status">
          {toastText}
        </div>
      )}
      <datalist id="dl-people">
        {ix.openFiles().map((p) => (
          <option key={p.id} value={p.name} />
        ))}
      </datalist>
      <datalist id="dl-places">
        {ix.dossier.places.map((p) => (
          <option key={p.id} value={p.label} />
        ))}
      </datalist>
    </PageProvider>
  );
}

const sheetKey = (sheet: Extract<Sheet, { what: "entry" }>) =>
  `${sheet.mode}-${sheet.pid}-${sheet.mode === "new" ? "" : sheet.eid}`;
