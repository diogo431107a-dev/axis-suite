// How the memory page writes sizes, times, costs and what each change was.

export const size = (bytes: number): string => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);
export const when = (at: string): string => new Date(at).toLocaleString();
export const money = (dollars: number | null): string =>
  dollars === null ? "" : dollars < 0.01 ? `${(dollars * 100).toFixed(2)}¢` : `$${dollars.toFixed(3)}`;

export const OPS: Record<string, string> = {
  seed: "laid out",
  create: "written",
  str_replace: "edited",
  insert: "added to",
  delete: "deleted",
  rename: "moved",
  manual_edit: "edited by you",
  revert: "put back",
};

export function sourceOf(source: string): string {
  if (source.startsWith("consolidate:")) return "after a chat";
  return { manual: "by you", seed: "new companion", cleanup: "tidy-up", rebuild: "rebuild" }[source] ?? source;
}
