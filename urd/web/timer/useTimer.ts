// The timer's state and its actions, shared by the whole page (the tab title shows the clock on
// every view). The numbers come from the server; the page only adds the seconds that pass.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Project, Session, SessionPatch, StartBody, Task, TimerState } from "../../shared/protocol.ts";
import { ApiFailure, api, query } from "../api.ts";
import { clockSkew } from "../clock.ts";
import { tagsFor } from "../tasks.ts";

/** What the next session will be named, set while nothing runs. */
export interface Draft {
  project: string;
  task: string;
  tags: string[];
}

const draftKey = (user: string) => `urd.next.${user}`;

function loadDraft(user: string): Draft | null {
  try {
    const value = JSON.parse(localStorage.getItem(draftKey(user)) ?? "null") as Partial<Draft> | null;
    if (typeof value?.project !== "string" || !Array.isArray(value.tags)) return null;
    return {
      project: value.project,
      // A draft kept before tasks had none.
      task: typeof value.task === "string" ? value.task : "",
      tags: value.tags.filter((t): t is string => typeof t === "string"),
    };
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
  /** the project, task and tags shown: the running session's, or the next one's */
  shown: Draft;
  busy: boolean;
  toggle: () => Promise<void>;
  /** starts a task again with its last tags; a running session stops for it */
  resume: (task: Task) => Promise<void>;
  setProject: (name: string) => Promise<void>;
  setTask: (name: string) => Promise<void>;
  setTags: (tags: string[]) => Promise<void>;
}

interface Options {
  user: string;
  today: string;
  projects: Project[];
  /** the latest used first */
  tasks: Task[];
  /** goes up when the server says something changed */
  revision: number;
  /** after a change made here */
  onChanged: () => void;
  onError: (err: unknown) => void;
}

export function useTimer({ user, today, projects, tasks, revision, onChanged, onError }: Options): Timer {
  const [state, setState] = useState<TimerState | null>(null);
  const [skew, setSkew] = useState(0);
  const [draft, setDraftState] = useState(() => loadDraft(user));
  const [busy, setBusy] = useState(false);
  const running = state?.running ?? null;

  const setDraft = useCallback(
    (next: Draft | null) => {
      setDraftState(next);
      saveDraft(user, next);
    },
    [user],
  );

  // While nothing runs, the next session takes the last one's names and tags unless told otherwise.
  const shown: Draft = useMemo(() => {
    if (running) return { project: running.project ?? "", task: running.task ?? "", tags: running.tags };
    const last = state?.last;
    return draft ?? { project: last?.project ?? "", task: last?.task ?? "", tags: last?.tags ?? [] };
  }, [running, draft, state?.last]);

  // What the numbers are about: the running session's project and task (the server knows them), or
  // the next one's. A project not made yet has no numbers, nor has a task in it.
  const nextProject = running ? null : shown.project.trim().toLowerCase();
  const nextProjectId = nextProject ? (projects.find((p) => p.name.toLowerCase() === nextProject)?.id ?? null) : null;
  const nextTask = running || (nextProject && !nextProjectId) ? null : shown.task.trim() || null;

  useEffect(() => {
    let stale = false;
    api<TimerState>(`/api/state${query({ today, project: nextProjectId, task: nextTask })}`).then(
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
  }, [today, nextProjectId, nextTask, revision, onError]);

  const start = useCallback(
    async (body: Omit<StartBody, "zone">) => {
      if (busy) return;
      setBusy(true);
      try {
        await api<Session>("/api/sessions/start", { method: "POST", body: { zone: browserZone(), ...body } });
        setDraft(null);
        onChanged();
      } catch (err) {
        onError(err);
      } finally {
        setBusy(false);
      }
    },
    [busy, setDraft, onChanged, onError],
  );

  const toggle = useCallback(async () => {
    if (!running) {
      return start({ project: shown.project.trim() || null, task: shown.task.trim() || null, tags: shown.tags });
    }
    if (busy) return;
    setBusy(true);
    try {
      await api<Session>("/api/sessions/stop", { method: "POST" }).catch((err: unknown) => {
        // Already stopped, on another device.
        if (!(err instanceof ApiFailure && err.code === "not-running")) throw err;
      });
      onChanged();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }, [busy, running, shown, start, onChanged, onError]);

  const resume = useCallback(
    (task: Task) => start({ project: task.project, task: task.name, tags: task.lastTags, switch: !!running }),
    [running, start],
  );

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

  // A new project or task brings the tags it had last time: on the next session, or on the running
  // one if it has none yet.
  const rename = useCallback(
    async (project: string, task: string) => {
      const known = tagsFor(tasks, project, task);
      if (running) {
        const patch: SessionPatch = { project: project || null, task: task || null };
        if (known && running.tags.length === 0) patch.tags = known;
        return patchRunning(patch);
      }
      setDraft({ project, task, tags: known ?? shown.tags });
    },
    [tasks, running, shown, patchRunning, setDraft],
  );

  const setProject = useCallback((name: string) => rename(name.trim(), shown.task), [rename, shown.task]);
  const setTask = useCallback((name: string) => rename(shown.project, name.trim()), [rename, shown.project]);

  const setTags = useCallback(
    async (tags: string[]) => {
      if (running) return patchRunning({ tags });
      setDraft({ ...shown, tags });
    },
    [running, shown, patchRunning, setDraft],
  );

  return { state, skew, shown, busy, toggle, resume, setProject, setTask, setTags };
}
