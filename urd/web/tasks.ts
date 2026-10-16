// Finding tasks by name, as the fields name them. Names are matched ignoring case, as the server does.
import type { Task } from "../shared/protocol.ts";

const same = (a: string | null, b: string) => (a ?? "").toLowerCase() === b.trim().toLowerCase();

/** The task called `name` in the project called `project` ("" for none, in either). */
export const findTask = (tasks: Task[], project: string, name: string): Task | undefined =>
  tasks.find((t) => same(t.project, project) && same(t.name, name));

/**
 * The tags a session of `project` and `task` starts with: those of that task's latest session, else
 * of the project's latest one; undefined when neither was used before. `tasks` come the latest used first.
 */
export function tagsFor(tasks: Task[], project: string, task: string): string[] | undefined {
  const exact = findTask(tasks, project, task);
  if (exact) return exact.lastTags;
  if (!project.trim()) return undefined;
  return tasks.find((t) => same(t.project, project))?.lastTags;
}
