import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  SignedOutError,
  fetchMe,
  goToSignIn,
  signInUrl,
  watchForSignIn,
  type Me,
} from "@axis-suite/heimdall-client/browser";
import type { Project, TagCount } from "../shared/protocol.ts";
import { api, describeError, query, setPageUser } from "./api.ts";
import { elapsed, useSecond } from "./clock.ts";
import { clock } from "./format.ts";
import { HistoryView } from "./history/HistoryView.tsx";
import { useToday } from "./hooks.ts";
import { listen } from "./live.ts";
import { useRoute, type Route } from "./nav.ts";
import { ProjectDialog } from "./projects/ProjectDialog.tsx";
import { ProjectsView } from "./projects/ProjectsView.tsx";
import { TimerView } from "./timer/TimerView.tsx";
import { useTimer, type Timer } from "./timer/useTimer.ts";
import { Link } from "./ui/Link.tsx";

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    fetchMe()
      .then((user) => {
        setPageUser(user.username);
        setMe(user);
      })
      .catch((err: unknown) => {
        if (err instanceof SignedOutError) goToSignIn(err);
        else setLoadError("Urd can't be reached. Try again in a moment.");
      });
  }, []);

  if (loadError) return <p className="p-8 text-center text-sm text-zinc-500">{loadError}</p>;
  if (!me) return null;
  return <SignedIn me={me} />;
}

function SignedIn({ me }: { me: Me }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [tags, setTags] = useState<TagCount[]>([]);
  // Goes up when something changed, here or on another device: everything shown is asked for again.
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  // Set when the session ends mid-use. Holds the sign-in URL.
  const [signedOut, setSignedOut] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Project | null>(null);
  const route = useRoute();
  const today = useToday();

  // Changes come in bursts (this tab's own, then the server's word for it): one reload for each burst.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changed = useCallback(() => {
    pending.current ??= setTimeout(() => {
      pending.current = null;
      setRevision((r) => r + 1);
    }, 150);
  }, []);

  const handleError = useCallback((err: unknown) => {
    if (err instanceof SignedOutError) setSignedOut(signInUrl(err.loginUrl));
    else setNotice(describeError(err));
  }, []);

  const timer = useTimer({
    user: me.username,
    today,
    projects: projects ?? [],
    revision,
    onChanged: changed,
    onError: handleError,
  });

  useEffect(() => {
    let stale = false;
    Promise.all([api<Project[]>(`/api/projects${query({ day: today })}`), api<TagCount[]>("/api/tags")]).then(
      ([p, t]) => {
        if (stale) return;
        setProjects(p);
        setTags(t);
      },
      (err: unknown) => !stale && handleError(err),
    );
    return () => {
      stale = true;
    };
  }, [today, revision, handleError]);

  // Live updates from other tabs and devices; and a fresh look whenever the tab is shown again.
  useEffect(
    () =>
      listen(me.username, {
        onChanged: changed,
        onReconnect: changed,
        onSignedOut: (loginUrl) => setSignedOut(signInUrl(loginUrl)),
        onOtherUser: () => location.reload(),
      }),
    [me.username, changed],
  );
  useEffect(() => {
    const onShow = () => document.visibilityState === "visible" && changed();
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [changed]);

  // While signed out, check again whenever the user comes back to this tab.
  useEffect(() => {
    if (!signedOut) return;
    return watchForSignIn(me.username, () => {
      setSignedOut(null);
      changed();
    });
  }, [signedOut, me.username, changed]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const setEstimate = useCallback(
    (project: Project, seconds: number) => {
      api(`/api/projects/${project.id}`, { method: "PATCH", body: { estimate: seconds } }).then(changed, handleError);
    },
    [changed, handleError],
  );

  let view;
  if (route.kind === "history") {
    view = (
      <HistoryView
        unnamed={route.unnamed}
        unnamedCount={timer.state?.unnamed ?? 0}
        projects={projects ?? []}
        tags={tags}
        skew={timer.skew}
        revision={revision}
        onChanged={changed}
        onError={handleError}
      />
    );
  } else if (route.kind === "projects") {
    view = <ProjectsView projects={projects} onOpen={setDialog} />;
  } else {
    view = (
      <TimerView
        timer={timer}
        today={today}
        projects={projects ?? []}
        tags={tags}
        onOpenProject={setDialog}
        onEstimate={setEstimate}
      />
    );
  }

  return (
    <div className="flex min-h-full flex-col bg-zinc-50 text-zinc-800">
      <TitleAndIcon timer={timer} />
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-zinc-50/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-1 px-3 py-2 sm:gap-2">
          <Link to={{ kind: "timer" }} className="mr-2 flex items-center gap-2 font-semibold text-zinc-800">
            <img src="/favicon.svg" alt="" className="h-6 w-6" />
            <span className="hidden min-[400px]:inline">Urd</span>
          </Link>
          <NavLink route={route} to={{ kind: "timer" }}>
            Timer
          </NavLink>
          <NavLink route={route} to={{ kind: "history", unnamed: false }}>
            History
          </NavLink>
          <NavLink route={route} to={{ kind: "projects" }}>
            Projects
          </NavLink>
          <a
            href={me.accountUrl}
            className="ml-auto truncate text-sm text-zinc-500 hover:text-zinc-800"
            title="Your account and sign-in, in Heimdall"
          >
            {me.name}
          </a>
        </div>
      </header>

      {signedOut && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-center gap-x-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          Your session has ended. A running timer keeps running;
          <a href={signedOut} target="_blank" rel="noopener" className="font-medium underline">
            sign in again
          </a>
          (in a new tab) to see it.
        </div>
      )}

      <main className="flex-1">{view}</main>

      {notice && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-rose-700 px-4 py-2 text-sm text-white shadow-lg"
        >
          {notice}
        </div>
      )}

      {dialog && (
        <ProjectDialog
          // The latest of it, after changes elsewhere.
          project={projects?.find((p) => p.id === dialog.id) ?? dialog}
          onChanged={changed}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function NavLink({ route, to, children }: { route: Route; to: Route; children: string }) {
  const here = route.kind === to.kind;
  return (
    <Link
      to={to}
      className={`rounded-md px-2.5 py-1 text-sm ${here ? "bg-zinc-200/70 font-medium text-zinc-900" : "text-zinc-500 hover:text-zinc-800"}`}
    >
      {children}
    </Link>
  );
}

/** The tab shows the running clock, and its icon whether one runs, on every view. */
function TitleAndIcon({ timer }: { timer: Timer }) {
  const running = timer.state?.running ?? null;
  const now = useSecond(!!running) + timer.skew;
  const title = running ? `${clock(elapsed(running, now))} · ${running.project ?? "No project"} — Urd` : "Urd";
  useEffect(() => {
    document.title = title;
  }, [title]);
  const live = !!running;
  useEffect(() => {
    const icon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (icon) icon.href = live ? "/favicon-running.svg" : "/favicon.svg";
  }, [live]);
  return null;
}
