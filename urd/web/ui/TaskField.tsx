import { useMemo } from "react";
import { LIMITS, type Task } from "../../shared/protocol.ts";
import { NameField, type NameFieldProps } from "./NameField.tsx";

/** A task's name, with the tasks of `project` (a name, "" for none) as suggestions, the latest used first. */
export function TaskField({
  tasks,
  project,
  placeholder = "No task",
  ...props
}: NameFieldProps & { tasks: Task[]; project: string }) {
  const names = useMemo(() => {
    const p = project.trim().toLowerCase();
    // tasks come the latest used first
    return tasks.filter((t) => t.name !== null && (t.project ?? "").toLowerCase() === p).map((t) => t.name!);
  }, [tasks, project]);
  return <NameField {...props} suggestions={names} maxLength={LIMITS.taskNameChars} placeholder={placeholder} />;
}
