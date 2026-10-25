import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangle, CloudOff, Menu, X } from "lucide-react";
import {
  SignedOutError,
  fetchMe,
  goToSignIn,
  signInUrl,
  watchForSignIn,
  type Me,
} from "@axis-suite/heimdall-client/browser";
import { addDays } from "../shared/dates.ts";
import {
  COLORS,
  type Journal,
  type JournalPatch,
  type Page,
  type PageSaved,
  type Settings,
  type Streak,
  type TagCount,
  type Template,
  type TemplateFields,
} from "../shared/protocol.ts";
import { BinView } from "./BinView.tsx";
import { Sidebar, type SidebarDialog } from "./Sidebar.tsx";
import { api, describeError, query, setPageUser } from "./api.ts";
import { resolveWeekStart } from "./calendar/calendar.ts";
import { MonthView } from "./calendar/MonthView.tsx";
import { YearView } from "./calendar/YearView.tsx";
import { DayView } from "./day/DayView.tsx";
import { BackupDialog } from "./dialogs/BackupDialog.tsx";
import { JournalDialog } from "./dialogs/JournalDialog.tsx";
import { SettingsDialog } from "./dialogs/SettingsDialog.tsx";
import { TemplatesDialog } from "./dialogs/TemplatesDialog.tsx";
import { longDate } from "./format.ts";
import { useToday } from "./hooks.ts";
import { go, useRoute } from "./nav.ts";
import { PageSync, type PageApi, type SyncStatus } from "./pages/sync.ts";
import { promptList } from "./prompts/prompts.ts";
import { SearchView } from "./search/SearchView.tsx";
import { AboutButton } from "./ui/About.tsx";
import { iconButton, label, primaryButton, textInput } from "./ui/buttons.ts";
import { Link } from "./ui/Link.tsx";

const pageApi: PageApi = {
  get: (journalId, date) => api<Page>(`/api/pages/${journalId}/${date}`),
  put: (journalId, date, body, keepalive) =>
    api<PageSaved>(`/api/pages/${journalId}/${date}`, { method: "PUT", body, keepalive }),
};

type DialogState =
  { kind: "journal"; journal?: Journal } | { kind: "templates" } | { kind: "settings" } | { kind: "backup" };

interface Notice {
  text: string;
  tone: "info" | "error";
}

const SAVED: SyncStatus = { kind: "saved" };
const NO_SYNC = { subscribe: () => () => {}, status: () => SAVED };

/** The journal opened last, for the next visit to start in. */
const lastJournalKey = (user: string) => `papyrus.journal.${user}`;
function rememberJournal(user: string, id: string) {
  try {
    localStorage.setItem(lastJournalKey(user), id);
  } catch {
    // not kept: the first journal opens next time
  }
}
function lastJournal(user: string): string | null {
  try {
    return localStorage.getItem(lastJournalKey(user));
  } catch {
    return null;
  }
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState("");
  const [journals, setJournals] = useState<Journal[] | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [settings, setSettings] = useState<Settings>({ prompts: null, weekStart: null });
  const [tags, setTags] = useState<TagCount[]>([]);
  const [streak, setStreak] = useState(0);
  // Goes up a moment after pages are saved (here or in another tab): calendars, tags and counts follow.
  const [revision, setRevision] = useState(0);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Set when the session ends mid-use. Holds the sign-in URL; unsaved text is kept.
  const [signedOut, setSignedOut] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const route = useRoute();
  const today = useToday();

  const handleError = useCallback((err: unknown) => {
    if (err instanceof SignedOutError) setSignedOut(signInUrl(err.loginUrl));
    else setNotice({ text: describeError(err), tone: "error" });
  }, []);

  /** Runs a change; on failure, says why and answers null. */
  const attempt = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn();
      } catch (err) {
        handleError(err);
        return null;
      }
    },
    [handleError],
  );

  const sync = useMemo(() => (me ? new PageSync({ api: pageApi, user: me.username }) : null), [me]);

  useEffect(() => {
    if (!sync) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    sync.onSignedOut = handleError;
    sync.onSaved = () => {
      timer ??= setTimeout(() => {
        timer = null;
        setRevision((r) => r + 1);
      }, 1500);
    };
    const detach = sync.attach();
    sync.adoptDrafts();
    return () => {
      detach();
      if (timer) clearTimeout(timer);
    };
  }, [sync, handleError]);

  const status = useSyncExternalStore((sync ?? NO_SYNC).subscribe, (sync ?? NO_SYNC).status);

  const loadJournals = useCallback(async () => setJournals(await api<Journal[]>("/api/journals")), []);

  useEffect(() => {
    fetchMe()
      .then(async (user) => {
        setPageUser(user.username);
        setMe(user);
        const [j, t, s] = await Promise.all([
          api<Journal[]>("/api/journals"),
          api<Template[]>("/api/templates"),
          api<Settings>("/api/settings"),
        ]);
        setJournals(j);
        setTemplates(t);
        setSettings(s);
      })
      .catch((err: unknown) => {
        if (err instanceof SignedOutError) goToSignIn(err);
        else setLoadError("Could not load your journals. Try again in a moment.");
      });
  }, []);

  // Tags, the streak and page counts change as pages are saved.
  useEffect(() => {
    if (!me) return;
    let stale = false;
    Promise.all([api<TagCount[]>("/api/tags"), api<Streak>(`/api/streak${query({ today })}`)]).then(
      ([t, s]) => {
        if (stale) return;
        setTags(t);
        setStreak(s.days);
      },
      (err: unknown) => !stale && handleError(err),
    );
    if (revision > 0) loadJournals().catch(handleError);
    return () => {
      stale = true;
    };
  }, [me, revision, today, loadJournals, handleError]);

  // While signed out, check again whenever the user comes back to this tab (e.g. after signing
  // in from the banner's link). Someone else signing in gets a fresh page.
  useEffect(() => {
    if (!signedOut || !me) return;
    return watchForSignIn(me.username, () => {
      setSignedOut(null);
      sync?.resume();
      setRevision((r) => r + 1);
    });
  }, [signedOut, me, sync]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const live = useMemo(() => journals?.filter((j) => !j.deletedAt) ?? [], [journals]);
  const binned = useMemo(() => journals?.filter((j) => j.deletedAt) ?? [], [journals]);
  const routeJournal = route.kind === "day" ? live.find((j) => j.id === route.journalId) : undefined;
  const current = routeJournal ?? live.find((j) => me && j.id === lastJournal(me.username)) ?? live[0] ?? null;
  const date = route.kind === "day" ? route.date : today;
  const weekStart = resolveWeekStart(settings.weekStart);
  const prompts = useMemo(() => promptList(settings.prompts), [settings.prompts]);

  useEffect(() => {
    if (me && routeJournal) rememberJournal(me.username, routeJournal.id);
  }, [me, routeJournal]);

  // The start page is today in the journal used last.
  useEffect(() => {
    if (route.kind === "home" && current) go({ kind: "day", journalId: current.id, date: today }, true);
  }, [route.kind, current, today]);

  // Days that haven't come yet can't be written: they open as today.
  useEffect(() => {
    if (route.kind === "day" && route.date > today) go({ ...route, date: today }, true);
  }, [route, today]);

  useEffect(() => {
    document.title = route.kind === "day" ? `${longDate(route.date)} · Papyrus` : "Papyrus";
  }, [route]);

  // Keys, when nobody is typing: ← → change the day, T goes to today, / searches. Ctrl+S saves everywhere.
  const routeRef = useRef(route);
  routeRef.current = route;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        sync?.flush();
        return;
      }
      const target = e.target as HTMLElement;
      if (e.key === "Escape" && target.tagName === "TEXTAREA" && !target.closest("dialog")) {
        target.blur();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || target.closest("input, textarea, select, dialog, [contenteditable]"))
        return;
      const r = routeRef.current;
      if (e.key === "/") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>("[data-search]")?.focus();
      } else if (r.kind === "day" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        const day = addDays(r.date, e.key === "ArrowLeft" ? -1 : 1);
        if (day <= today) go({ ...r, date: day });
      } else if (e.key.toLowerCase() === "t" && current) {
        go({ kind: "day", journalId: r.kind === "day" ? r.journalId : current.id, date: today });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sync, current, today]);

  // ── Changes ──────────────────────────────────────────────────────────────────────────────────

  async function saveJournal(journal: Journal | undefined, fields: Required<JournalPatch>): Promise<boolean> {
    const saved = await attempt(() =>
      journal
        ? api<Journal>(`/api/journals/${journal.id}`, { method: "PATCH", body: fields })
        : api<Journal>("/api/journals", { method: "POST", body: fields }),
    );
    if (!saved) return false;
    // A new journal: set its template too, which POST doesn't take.
    if (!journal && fields.templateId) {
      await attempt(() =>
        api(`/api/journals/${saved.id}`, { method: "PATCH", body: { templateId: fields.templateId } }),
      );
    }
    await loadJournals().catch(handleError);
    if (!journal) go({ kind: "day", journalId: saved.id, date: today });
    return true;
  }

  async function binJournal(journal: Journal): Promise<boolean> {
    sync?.flush();
    const done = await attempt(() => api(`/api/journals/${journal.id}`, { method: "DELETE" }));
    if (done === null) return false;
    await loadJournals().catch(handleError);
    setNotice({ text: `${journal.name} is in the recycle bin.`, tone: "info" });
    if (route.kind === "day" && route.journalId === journal.id) go({ kind: "home" }, true);
    return true;
  }

  async function restoreJournal(journal: Journal) {
    const restored = await attempt(() => api<Journal>(`/api/journals/${journal.id}/restore`, { method: "POST" }));
    if (!restored) return;
    await loadJournals().catch(handleError);
    setRevision((r) => r + 1);
    setNotice({ text: `${journal.name} is back.`, tone: "info" });
  }

  async function purgeJournal(journal: Journal) {
    const pages = journal.pages === 1 ? "its page" : `its ${journal.pages} pages`;
    if (!window.confirm(`Delete ${journal.name} and ${pages} for good? This can't be undone.`)) return;
    const done = await attempt(() => api(`/api/journals/${journal.id}?purge=1`, { method: "DELETE" }));
    if (done !== null) await loadJournals().catch(handleError);
  }

  async function saveTemplate(id: string | null, fields: TemplateFields): Promise<Template | null> {
    const saved = await attempt(() =>
      id
        ? api<Template>(`/api/templates/${id}`, { method: "PATCH", body: fields })
        : api<Template>("/api/templates", { method: "POST", body: fields }),
    );
    if (saved) setTemplates((list) => (id ? list.map((t) => (t.id === id ? saved : t)) : [...list, saved]));
    return saved;
  }

  async function deleteTemplate(template: Template): Promise<boolean> {
    const done = await attempt(() => api(`/api/templates/${template.id}`, { method: "DELETE" }));
    if (done === null) return false;
    setTemplates((list) => list.filter((t) => t.id !== template.id));
    await loadJournals().catch(handleError);
    return true;
  }

  async function saveSettings(next: Settings): Promise<boolean> {
    const saved = await attempt(() => api<Settings>("/api/settings", { method: "PUT", body: next }));
    if (saved) setSettings(saved);
    return saved !== null;
  }

  async function afterImport() {
    const [j, t, s] = await Promise.all([
      api<Journal[]>("/api/journals"),
      api<Template[]>("/api/templates"),
      api<Settings>("/api/settings"),
    ]).catch((err: unknown) => {
      handleError(err);
      return [null, null, null] as const;
    });
    if (j) setJournals(j);
    if (t) setTemplates(t);
    if (s) setSettings(s);
    setRevision((r) => r + 1);
  }

  // ── Page ─────────────────────────────────────────────────────────────────────────────────────

  if (loadError) return <p className="p-8 text-sm text-red-600">{loadError}</p>;
  if (!me || !journals || !sync) return <p className="p-8 text-sm text-stone-400">Opening your journals…</p>;

  const openDialog = (kind: SidebarDialog, journal?: Journal) => {
    setNavOpen(false);
    setDialog(kind === "journal" ? { kind, journal } : { kind });
  };

  let view;
  if (route.kind === "bin") {
    view = <BinView binned={binned} onRestore={restoreJournal} onPurge={purgeJournal} />;
  } else if (!current) {
    view = (
      <FirstJournal
        hasBin={binned.length > 0}
        onCreate={(name) => saveJournal(undefined, { name, color: "amber", templateId: null })}
      />
    );
  } else if (route.kind === "day" && !routeJournal) {
    view = (
      <p className="mx-auto max-w-xl px-6 py-16 text-center text-sm text-stone-500">
        This journal doesn't exist, or it is in the{" "}
        <Link to={{ kind: "bin" }} className="text-amber-800 underline">
          recycle bin
        </Link>
        .
      </p>
    );
  } else if (route.kind === "day" && route.date <= today) {
    view = (
      <DayView
        sync={sync}
        journal={routeJournal!}
        journals={live}
        date={route.date}
        today={today}
        templates={templates}
        prompts={prompts}
        revision={revision}
        onError={handleError}
      />
    );
  } else if (route.kind === "month") {
    view = (
      <MonthView
        journals={live}
        journalId={route.journalId}
        month={route.month}
        today={today}
        weekStart={weekStart}
        defaultJournal={current}
        revision={revision}
        onError={handleError}
      />
    );
  } else if (route.kind === "year") {
    view = (
      <YearView
        journals={live}
        journalId={route.journalId}
        year={route.year}
        today={today}
        defaultJournal={current}
        revision={revision}
        onError={handleError}
      />
    );
  } else if (route.kind === "search") {
    view = (
      <SearchView journals={live} q={route.q} journalId={route.journalId} revision={revision} onError={handleError} />
    );
  }

  return (
    <div className="flex h-full bg-stone-50 text-stone-800">
      {navOpen && (
        <div className="fixed inset-0 z-30 bg-stone-900/30 md:hidden" onClick={() => setNavOpen(false)} aria-hidden />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 border-r border-stone-200 bg-stone-100 transition-transform md:static md:z-auto
          md:w-64 md:shrink-0 md:translate-x-0 ${navOpen ? "translate-x-0 shadow-xl" : "-translate-x-full"}`}
      >
        <button
          type="button"
          className={`${iconButton} absolute top-3 right-3 md:hidden`}
          aria-label="Close the menu"
          onClick={() => setNavOpen(false)}
        >
          <X className="h-5 w-5" />
        </button>
        {current && (
          <Sidebar
            me={me}
            route={route}
            journals={live}
            journal={current}
            date={date}
            today={today}
            weekStart={weekStart}
            tags={tags}
            streak={streak}
            binCount={binned.length}
            revision={revision}
            onDialog={openDialog}
            onNavigate={() => setNavOpen(false)}
            onError={handleError}
          />
        )}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-stone-200 bg-stone-50/95 px-3 py-2 backdrop-blur md:hidden">
          <button type="button" className={iconButton} aria-label="Menu" onClick={() => setNavOpen(true)}>
            <Menu className="h-5 w-5" />
          </button>
          <AboutButton className="px-1 font-serif font-semibold text-stone-800">Papyrus</AboutButton>
        </div>

        {signedOut && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-x-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            Your session has ended. What you write is kept in this browser and saved once you
            <a href={signedOut} target="_blank" rel="noopener" className="font-medium underline">
              sign in again
            </a>
            (in a new tab).
          </div>
        )}
        <SyncNotice status={status} route={route} />

        {view}
      </main>

      {notice && (
        <div
          role="status"
          className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm shadow-lg ${
            notice.tone === "error" ? "bg-red-700 text-white" : "bg-stone-800 text-white"
          }`}
        >
          {notice.text}
        </div>
      )}

      {dialog?.kind === "journal" && (
        <JournalDialog
          journal={dialog.journal}
          templates={templates}
          suggestedColor={COLORS.find((c) => !journals.some((j) => j.color === c))}
          onSave={(fields) => saveJournal(dialog.journal, fields)}
          onBin={dialog.journal ? () => binJournal(dialog.journal!) : undefined}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "templates" && (
        <TemplatesDialog
          templates={templates}
          onSave={saveTemplate}
          onDelete={deleteTemplate}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "settings" && (
        <SettingsDialog settings={settings} onSave={saveSettings} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "backup" && (
        <BackupDialog onImported={() => void afterImport()} onError={handleError} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

/** Saving trouble that isn't on the page being looked at. */
function SyncNotice({ status, route }: { status: SyncStatus; route: ReturnType<typeof useRoute> }) {
  if (status.kind === "offline") {
    return (
      <div
        role="status"
        className="flex items-center gap-2 border-b border-stone-200 bg-stone-100 px-4 py-2 text-sm text-stone-700"
      >
        <CloudOff className="h-4 w-4 shrink-0" aria-hidden />
        Offline. What you write is kept in this browser and saved when Papyrus can be reached again.
      </div>
    );
  }
  if (status.kind === "conflict" || status.kind === "problem") {
    const here = route.kind === "day" && route.journalId === status.journalId && route.date === status.date;
    if (here) return null;
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-x-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        {status.kind === "conflict"
          ? `The page of ${longDate(status.date)} was changed elsewhere while you were writing it.`
          : `The page of ${longDate(status.date)} couldn't be saved.`}
        <Link to={{ kind: "day", journalId: status.journalId, date: status.date }} className="font-medium underline">
          Open it
        </Link>
      </div>
    );
  }
  return null;
}

/** The first visit: nothing to show until there is a journal. */
function FirstJournal({ hasBin, onCreate }: { hasBin: boolean; onCreate: (name: string) => Promise<boolean> }) {
  const [name, setName] = useState("Journal");
  const [busy, setBusy] = useState(false);
  return (
    <div className="mx-auto mt-16 w-full max-w-md px-6">
      <h1 className="mb-2 font-serif text-3xl text-stone-900">Welcome to Papyrus</h1>
      <p className="mb-6 text-sm text-stone-500">
        A page for every day. Start a journal; you can add others (work, dreams, travel…) later.
        {hasBin && " Or restore one from the recycle bin."}
      </p>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await onCreate(name.trim());
          setBusy(false);
        }}
      >
        <label htmlFor="first-journal" className={label}>
          Name
        </label>
        <input
          id="first-journal"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className={textInput}
        />
        <button type="submit" className={primaryButton} disabled={busy || !name.trim()}>
          Start writing
        </button>
      </form>
      {hasBin && (
        <p className="mt-6 text-sm">
          <Link to={{ kind: "bin" }} className="text-amber-800 underline">
            Open the recycle bin
          </Link>
        </p>
      )}
    </div>
  );
}
