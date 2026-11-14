// Paths in a companion's memory.
//
// The model names memory files as paths under /memories, the way the memory tool defines them.
// In the database a file is a row keyed by companion and its path relative to /memories
// ("story/recent.md"), and a directory is nothing but a prefix of such paths ("story"). Every path
// the model or the page sends is checked here before anything is read or written: it must stay
// inside /memories, however it is spelled.

export const ROOT = "/memories";

/** A path the model or the page may not use. Its message is what the model is told. */
export class PathError extends Error {}

/** A file or directory name: no slashes, and no control characters. */
const nameable = (segment: string): boolean =>
  [...segment].every((char) => char !== "/" && char !== "\\" && char.charCodeAt(0) >= 0x20 && char !== "\u007f");

/**
 * The path relative to /memories ("" for /memories itself), or a PathError. Refuses anything
 * that is not under /memories, however it is written: "..", "." and empty segments, backslashes,
 * control characters, and the same tricks percent-encoded (%2e%2e%2f), decoded until nothing
 * changes.
 */
export function relativePath(raw: unknown): string {
  if (typeof raw !== "string" || raw === "") throw new PathError("Error: A path is required");
  let path = raw;
  for (let round = 0; round < 3 && /%[0-9a-f]{2}/i.test(path); round++) {
    try {
      path = decodeURIComponent(path);
    } catch {
      throw new PathError(`Error: The path ${raw} is not valid`);
    }
  }
  const refuse = (why: string): never => {
    throw new PathError(`Error: The path ${raw} is not valid: ${why}`);
  };
  if (path.includes("\\")) refuse("backslashes are not allowed");
  if (path !== ROOT && !path.startsWith(`${ROOT}/`)) refuse(`every path must be inside ${ROOT}`);
  let rest = path.slice(ROOT.length + 1);
  if (rest.endsWith("/")) rest = rest.slice(0, -1);
  if (rest === "") return "";
  const segments = rest.split("/");
  for (const segment of segments) {
    if (segment === "") refuse("it has an empty segment");
    if (segment === "." || segment === "..") refuse("it may not contain . or .. segments");
    if (!nameable(segment)) refuse("it contains characters a file name can't have");
    if (segment.length > 120) refuse("a file name is 120 characters at most");
  }
  if (segments.length > 4) refuse("memory is at most 4 directories deep");
  return segments.join("/");
}

/** The path as the model sees it. */
export const absolute = (relative: string): string => (relative ? `${ROOT}/${relative}` : ROOT);

/** Every directory a path sits in, nearest last: "a/b/c.md" → ["a", "a/b"]. */
export function parentsOf(relative: string): string[] {
  const segments = relative.split("/");
  return segments.slice(0, -1).map((_, at) => segments.slice(0, at + 1).join("/"));
}

/** Whether `path` is `dir` itself or inside it. The root ("") holds everything. */
export const within = (path: string, dir: string): boolean => dir === "" || path === dir || path.startsWith(`${dir}/`);
