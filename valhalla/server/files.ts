// Reading and writing the data folder.
//
// Everything Valhalla keeps is a plain file you can open in an editor: one JSON file per
// character and persona, and one append-only JSONL log per conversation. Three things make that
// safe to do from a running server, and they all live here:
//
//   - a write lands whole or not at all (write a .tmp file, then rename over the target),
//   - two writes to one path never interleave (each path has a queue),
//   - a log cut short by a crash loses only the unfinished line,
//   - a file Windows has briefly locked is written anyway, by waiting for the lock to go.
import { mkdir, readFile, readdir, rename, rm, writeFile, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { StoreError } from "./errors.ts";

/** Where everything is kept. Relative to wherever the server was started. */
export const DATA_DIR = process.env.VALHALLA_DATA ?? "data";

export const pathOf = (...parts: string[]): string => join(DATA_DIR, ...parts);

// One queue per path. Writes to the same file run one after another, so a read never catches a
// half-written file and two requests never race.
const queues = new Map<string, Promise<unknown>>();

function serialize<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  // Run after whatever is queued, whether that succeeded or failed.
  const next = previous.then(work, work);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, settled);
  // Let the map forget a path once nothing is waiting on it.
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return next;
}

// Windows lets a virus scanner, the search indexer or a sync client hold a file open for a
// moment after it is written, and a write or a rename that lands in that moment is refused with
// EPERM — not because anything is wrong, but because something else got there first. The lock is
// gone in a few milliseconds, so the work is tried again for about a second before it is allowed
// to fail. This is not a Windows-only path: elsewhere these errors mean what they say, and the
// first attempt is the only one.
const LOCKED = new Set(["EPERM", "EACCES", "EBUSY"]);
const WAITS = [10, 25, 50, 100, 200, 400];

const sleep = (ms: number) => new Promise((go) => setTimeout(go, ms));

async function pastBriefLocks<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (err) {
      const wait = WAITS[attempt];
      const code = (err as { code?: string }).code;
      if (wait === undefined || code === undefined || !LOCKED.has(code)) throw err;
      await sleep(wait);
    }
  }
}

/** A lock that never let go, said in a way that names what to go and look at. */
function asLock(file: string, err: unknown): unknown {
  const code = (err as { code?: string }).code;
  if (code === undefined || !LOCKED.has(code)) return err;
  return new StoreError(
    500,
    `Another program is holding ${file}, so Valhalla could not write it. ` +
      "Antivirus, a backup or sync client, or the folder open somewhere else are the usual ones.",
  );
}

/** Writes `value` as formatted JSON, leaving either the old file or the new one, never a mix. */
export function writeJson(file: string, value: unknown): Promise<void> {
  return serialize(file, async () => {
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    const text = `${JSON.stringify(value, null, 2)}\n`;
    try {
      await pastBriefLocks(async () => {
        await writeFile(temporary, text, "utf8");
        // rename() replaces the target in one step, on Windows as well as elsewhere.
        await rename(temporary, file);
      });
    } catch (err) {
      // The target still holds what it held before. Take the half-written copy with it, so
      // the folder stays something you can read.
      await rm(temporary, { force: true }).catch(() => {});
      throw asLock(file, err);
    }
  });
}

/** The parsed contents of a JSON file, or null when there is no such file. */
export async function readJson(file: string): Promise<unknown | null> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return null;
    throw err;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new StoreError(500, `${file} is not valid JSON. Fix or move the file, then try again.`);
  }
}

/** Adds one line to a log. The line is complete before anything else may write to the file. */
export function appendLine(file: string, value: unknown): Promise<void> {
  return appendLines(file, [value]);
}

/**
 * Adds several lines in one write, so that they land together or not at all. A turn and the
 * reply to it belong to each other: half a pair on disk reads back as a question nobody
 * answered.
 */
export function appendLines(file: string, values: readonly unknown[]): Promise<void> {
  if (values.length === 0) return Promise.resolve();
  const text = values.map((value) => `${JSON.stringify(value)}\n`).join("");
  return serialize(file, async () => {
    await mkdir(dirname(file), { recursive: true });
    try {
      await pastBriefLocks(() => appendFile(file, text, "utf8"));
    } catch (err) {
      throw asLock(file, err);
    }
  });
}

/**
 * Every line of a log, oldest first. A final line with no newline was cut short by a crash
 * mid-write: it is dropped, and said so once. A broken line anywhere else is not something to
 * quietly skip — it would silently change a conversation — so it stops the read.
 */
export async function readLines(file: string): Promise<unknown[]> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return [];
    throw err;
  }
  if (text === "") return [];
  const lines = text.split("\n");
  // A finished file ends in a newline, so the last piece is empty. Anything else is a cut-off
  // line: a write that never got to finish.
  const tail = lines.pop();
  if (tail !== "") {
    console.log(`${file}: the last line was never finished, so it was left out. Nothing else changed.`);
  }
  return lines.map((line, index) => {
    try {
      return JSON.parse(line) as unknown;
    } catch {
      throw new StoreError(500, `${file}, line ${index + 1} is not valid JSON. Fix the file, then try again.`);
    }
  });
}

/** The names of the .json files in a folder, without the extension. Missing folder means none. */
export async function listIds(dir: string): Promise<string[]> {
  try {
    const names = await readdir(dir);
    return names.filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -".json".length));
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return [];
    throw err;
  }
}

/** The names of the subfolders of a folder. Missing folder means none. */
export async function listFolders(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return [];
    throw err;
  }
}

/** Deletes a file or a folder and everything in it. Doing it twice is not an error. */
export function remove(target: string): Promise<void> {
  // maxRetries waits out a brief Windows lock the way pastBriefLocks does, except that rm()
  // knows how to do that itself.
  return serialize(target, () => rm(target, { recursive: true, force: true, maxRetries: 6, retryDelay: 50 }));
}
