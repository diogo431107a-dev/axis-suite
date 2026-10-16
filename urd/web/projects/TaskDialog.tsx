import { useState } from "react";
import { LIMITS, type Project, type Task, type TaskPatch } from "../../shared/protocol.ts";
import { api, describeError } from "../api.ts";
import { hours, interruptionsText } from "../format.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { ProjectField } from "../ui/ProjectField.tsx";
import { closeDialog } from "../ui/closeDialog.ts";
import { label, primaryButton, textInput } from "../ui/buttons.ts";

interface TaskDialogProps {
  task: Task;
  projects: Project[];
  onChanged: () => void;
  onClose: () => void;
}

/**
 * A task: its name and its project, which change all its sessions. The sessions of a project
 * without a task can be given one here.
 */
export function TaskDialog({ task, projects, onChanged, onClose }: TaskDialogProps) {
  const [name, setName] = useState(task.name ?? "");
  const [project, setProject] = useState(task.project ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { overall, month } = task.periods;

  async function save(form: Element) {
    const patch: TaskPatch = { projectId: task.projectId, name: task.name };
    if (name.trim() !== (task.name ?? "")) patch.rename = name.trim() || null;
    if (project.trim() !== (task.project ?? "")) patch.project = project.trim() || null;
    if (patch.rename === undefined && patch.project === undefined) return closeDialog(form);
    setBusy(true);
    setError("");
    try {
      await api("/api/tasks", { method: "PATCH", body: patch });
      onChanged();
      closeDialog(form);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={task.name ?? "No task"} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save(e.currentTarget);
        }}
      >
        <div>
          <label htmlFor="task-name" className={label}>
            Name
          </label>
          <input
            id="task-name"
            data-autofocus
            value={name}
            maxLength={LIMITS.taskNameChars}
            placeholder="No task"
            onChange={(e) => setName(e.target.value)}
            className={textInput}
          />
        </div>
        <div>
          <label htmlFor="task-project" className={label}>
            Project
          </label>
          <ProjectField
            id="task-project"
            value={project}
            projects={projects}
            onCommit={setProject}
            onText={setProject}
            placeholder="No project"
          />
        </div>
        <p className="text-sm text-zinc-500">
          {hours(overall.seconds)} in {interruptionsText(overall.sessions)}, {hours(month.seconds)} this month. A change
          applies to every one of its sessions; a name the project already has puts the two tasks together.
        </p>
        {error && (
          <p role="alert" className="text-sm text-rose-700">
            {error}
          </p>
        )}
        <div>
          <button type="submit" className={primaryButton} disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}
