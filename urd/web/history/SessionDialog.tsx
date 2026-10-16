import { useState } from "react";
import type { Project, Session, SessionPatch, TagCount, Task } from "../../shared/protocol.ts";
import { instantOf } from "../../shared/zones.ts";
import { api, describeError } from "../api.ts";
import { clock, dayTitle, fromLocalInput, localInput } from "../format.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { ProjectField } from "../ui/ProjectField.tsx";
import { TagsField } from "../ui/TagsField.tsx";
import { TaskField } from "../ui/TaskField.tsx";
import { closeDialog } from "../ui/closeDialog.ts";
import { dangerButton, label, primaryButton, textInput } from "../ui/buttons.ts";

interface SessionDialogProps {
  session: Session;
  projects: Project[];
  tasks: Task[];
  tags: TagCount[];
  onChanged: () => void;
  onError: (err: unknown) => void;
  onClose: () => void;
}

/**
 * A session's project, task and tags, and its times, which can only shorten it: the start can move
 * later, the end earlier. Ending a running session stops it then.
 */
export function SessionDialog({ session, projects, tasks, tags, onChanged, onError, onClose }: SessionDialogProps) {
  const running = session.endedAt === null;
  const [project, setProject] = useState(session.project ?? "");
  const [task, setTask] = useState(session.task ?? "");
  const [tagList, setTagList] = useState(session.tags);
  const [start, setStart] = useState(localInput(session.startedAt));
  const [end, setEnd] = useState(running ? "" : localInput(session.endedAt!));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const startMs = fromLocalInput(start);
  const endMs = end === "" ? null : fromLocalInput(end);
  const latestEnd = running ? Date.now() : Date.parse(session.endedAt!);
  const problem =
    startMs === null
      ? "Give the start a date and time."
      : startMs < Date.parse(session.startedAt)
        ? "The start can only move later: time can't be added."
        : end !== "" && endMs === null
          ? "Give the end a date and time."
          : endMs !== null && endMs > latestEnd
            ? "The end can only move earlier: time can't be added."
            : startMs >= (endMs ?? latestEnd)
              ? "The session must end after it starts."
              : "";
  const length = startMs !== null && !problem ? Math.floor(((endMs ?? latestEnd) - startMs) / 1000) : null;

  async function save(form: Element) {
    const patch: SessionPatch = {};
    if (project.trim() !== (session.project ?? "")) patch.project = project.trim() || null;
    if (task.trim() !== (session.task ?? "")) patch.task = task.trim() || null;
    if (tagList.join("\n") !== session.tags.join("\n")) patch.tags = tagList;
    const startedAt = instantOf(Math.floor(startMs! / 1000) * 1000);
    if (startedAt !== session.startedAt) patch.startedAt = startedAt;
    if (endMs !== null) {
      const endedAt = instantOf(Math.floor(endMs / 1000) * 1000);
      if (endedAt !== session.endedAt) patch.endedAt = endedAt;
    }
    if (Object.keys(patch).length === 0) return closeDialog(form);
    setBusy(true);
    setError("");
    try {
      await api(`/api/sessions/${session.id}`, { method: "PATCH", body: patch });
      onChanged();
      closeDialog(form);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(button: Element) {
    setBusy(true);
    try {
      await api(`/api/sessions/${session.id}`, { method: "DELETE" });
      onChanged();
      closeDialog(button);
    } catch (err) {
      onError(err);
      setBusy(false);
    }
  }

  return (
    <Dialog title={`Session of ${dayTitle(session.day)}`} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem) void save(e.currentTarget);
        }}
      >
        <div>
          <label htmlFor="session-project" className={label}>
            Project
          </label>
          <ProjectField
            id="session-project"
            value={project}
            projects={projects}
            onCommit={setProject}
            onText={setProject}
          />
        </div>
        <div>
          <label htmlFor="session-task" className={label}>
            Task
          </label>
          <TaskField
            id="session-task"
            value={task}
            tasks={tasks}
            project={project}
            onCommit={setTask}
            onText={setTask}
          />
        </div>
        <div>
          <label htmlFor="session-tags" className={label}>
            Tags
          </label>
          <TagsField id="session-tags" tags={tagList} suggestions={tags.map((t) => t.tag)} onChange={setTagList} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="session-start" className={label}>
              Started
            </label>
            <input
              id="session-start"
              type="datetime-local"
              step={1}
              value={start}
              min={localInput(session.startedAt)}
              max={running ? undefined : localInput(session.endedAt!)}
              onChange={(e) => setStart(e.target.value)}
              className={textInput}
            />
          </div>
          <div>
            <label htmlFor="session-end" className={label}>
              {running ? "Ended (stops it)" : "Ended"}
            </label>
            <input
              id="session-end"
              type="datetime-local"
              step={1}
              value={end}
              min={start}
              max={running ? undefined : localInput(session.endedAt!)}
              onChange={(e) => setEnd(e.target.value)}
              className={textInput}
            />
          </div>
        </div>
        <p className={`text-sm ${problem ? "text-rose-700" : "text-zinc-500"}`} role={problem ? "alert" : undefined}>
          {problem ||
            `${running && endMs === null ? "Running for" : "Length:"} ${clock(length ?? 0)}. Times can only shorten a session.`}
        </p>
        {error && (
          <p role="alert" className="text-sm text-rose-700">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className={primaryButton} disabled={busy || !!problem}>
            Save
          </button>
          {confirmDelete ? (
            <button
              type="button"
              className={`${dangerButton} ml-auto`}
              disabled={busy}
              onClick={(e) => void remove(e.currentTarget)}
            >
              Delete for good
            </button>
          ) : (
            <button type="button" className={`${dangerButton} ml-auto`} onClick={() => setConfirmDelete(true)}>
              Delete…
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
