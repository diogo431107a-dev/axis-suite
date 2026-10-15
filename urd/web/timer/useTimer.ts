// The timer's state and its actions, shared by the whole page (the tab title shows the clock on
// every view). The numbers come from the server; the page only adds the seconds that pass.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Project, Session, SessionPatch, StartBody, TimerState } from "../../shared/protocol.ts";
import { ApiFailure, api, query } from "../api.ts";
import { clockSkew } from "../clock.ts";

/** What the next session will be named, set while nothing runs. */
export interface Draft {
  project: string;
  tags: string[];
}

const draftKey = (user: string) => `urd.next.${user}`;

function loadDraft(user: string): Draft | null {
  try {
    const value = JSON.parse(localStorage.getItem(draftKey(user)) ?? "null") as Partial<Draft> | null;
    if (typeof value?.project !== "string" || !Array.isArray(value.tags)) return null;
    return { project: value.project, tags: value.tags.filter((t): t is string => typeof t === "string") };
  } catch {
    return null;
  }
}

function saveDraft(user: string, draft: Draft | null): void {
  try {
    if (draft) localStorage.setItem(draftKey(user), JSON.stringify(draft));
    else localStorage.removeItem(draftKey(user));
  } catch {
    // not kept: the next session takes the last one's name
  }
}

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export interface Timer {
  state: TimerState | null;
  /** how far the server's clock is ahead of this computer's (ms) */
  skew: number;
  /** the project and tags shown: the running session's, or the next one's */
  shown: Draft;
  busy: boolean;
  toggle: () => Promise<void>;
  setProject: (name: string) => Promise<void>;
  setTags: (tags: string[]) => Promise<void>;
}

interface Options {
  user: string;
  today: string;
  projects: Project[];
  /** goes up when the server says something changed */
  revision: number;
  /** after a change made here */
  onChanged: () => void;
  onError: (err: unknown) => void;
}

export function useTimer({ user, today, projects, revision, onChanged, onError }: Options): Timer {
  const [state, setState] = useState<TimerState | null>(null);
  const [skew, setSkew] = useState(0);
  const [draft, setDraftState] = useState(() => loadDraft(user));
  const [busy, setBusy] = useState(false);
  const [reloads, setReloads] = useState(0);
  const running = state?.running ?? null;

  const setDraft = useCallback(
    (next: Draft | null) => {
      setDraftState(next);
      saveDraft(user, next);
    },
    [user],
  );

  // While nothing runs, the next session takes the last one's project and tags unless told otherwise.
  const shown: Draft = useMemo(() => {
    if (running) return { project: running.project ?? "", tags: running.tags };
    return draft ?? { project: state?.last?.project ?? "", tags: state?.last?.tags ?? [] };
  }, [running, draft, state?.last]);

  // The project the numbers are about: the running session's (the server knows it), or the next one's.
  const nextProjectId = running
    ? ""
    : (projects.find((p) => p.name.toLowerCase() === shown.project.trim().toLowerCase())?.id ?? "");

  useEffect(() => {
    let stale = false;
    api<TimerState>(`/api/state${query({ today, project: nextProjectId })}`).then(
      (s) => {
        if (stale) return;
        setSkew(clockSkew(s.now));
        setState(s);
      },
      (err: unknown) => !stale && onError(err),
    );
    return () => {
      stale = true;
    };
  }, [today, nextProjectId, revision, reloads, onError]);

  // When the running session reaches its automatic stop, ask the server how things stand.
  const cutoffAt = running?.cutoffAt;
  useEffect(() => {
    if (!cutoffAt) return;
    const wait = Date.parse(cutoffAt) - (Date.now() + skew) + 1500;
    // Longer than setTimeout can wait means a day or more away; a later reload sets it again.
    if (wait > 2 ** 31 - 1) return;
    const timer = setTimeout(() => setReloads((n) => n + 1), Math.max(0, wait));
    return () => clearTimeout(timer);
  }, [cutoffAt, skew]);

  const toggle = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (running) {
        await api<Session>("/api/sessions/stop", { method: "POST" }).catch((err: unknown) => {
          // Already stopped, on another device or by itself.
          if (!(err instanceof ApiFailure && err.code === "not-running")) throw err;
        });
      } else {
        const body: StartBody = { zone: browserZone(), project: shown.project.trim() || null, tags: shown.tags };
        await api<Session>("/api/sessions/start", { method: "POST", body });
        setDraft(null);
      }
      onChanged();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }, [busy, running, shown, setDraft, onChanged, onError]);

  const patchRunning = useCallback(
    async (patch: SessionPatch) => {
      if (!running) return;
      try {
        await api<Session>(`/api/sessions/${running.id}`, { method: "PATCH", body: patch });
        onChanged();
      } catch (err) {
        onError(err);
      }
    },
    [running, onChanged, onError],
  );

  const setProject = useCallback(
    async (name: string) => {
      if (running) return patchRunning({ project: name.trim() || null });
      setDraft({ ...shown, project: name.trim() });
    },
    [running, shown, patchRunning, setDraft],
  );

  const setTags = useCallback(
    async (tags: string[]) => {
      if (running) return patchRunning({ tags });
      setDraft({ ...shown, tags });
    },
    [running, shown, patchRunning, setDraft],
  );

  return { state, skew, shown, busy, toggle, setProject, setTags };
}
