// Whose folder is whose.
//
// Everyone signed in through Heimdall gets a folder of their own, named after their username:
//
//   <STATE_DIRECTORY>/users/<username>/characters/<id>.json
//                                     /personas/<id>.json
//                                     /conversations/<id>/conversation.json, turns.jsonl
//
// Nothing outside it is ever read on their behalf, so one person never sees another's.
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { StoreError } from "./errors.ts";

/** Where everything is kept: /var/lib/valhalla on a server, ./data in development. */
export const STATE_DIR = process.env.STATE_DIRECTORY ?? "data";

// Heimdall's usernames are short and plain. Anything else is refused rather than allowed to
// become part of a path.
const USERNAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** The folder of one person's things. */
export function rootOf(username: string, state: string = STATE_DIR): string {
  if (!USERNAME.test(username) || username.includes("..")) {
    throw new StoreError(403, "Valhalla can't keep things for this username");
  }
  return join(state, "users", username);
}

/**
 * Deletes the folder of everyone no longer in Heimdall, and says whose went and whose could not.
 * Called at startup with knownUsers(); never called when the list is unknown. A folder that can't
 * be deleted (one put there by hand, as root) is left and reported: it must not keep Valhalla down.
 */
export async function removeUnknownOwners(
  known: ReadonlySet<string>,
  state: string = STATE_DIR,
): Promise<{ removed: string[]; failed: { name: string; error: string }[] }> {
  const usersDir = join(state, "users");
  let names: string[];
  try {
    names = (await readdir(usersDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { removed: [], failed: [] };
    throw err;
  }
  const removed: string[] = [];
  const failed: { name: string; error: string }[] = [];
  for (const name of names.filter((n) => !known.has(n)).sort()) {
    try {
      await rm(join(usersDir, name), { recursive: true, force: true, maxRetries: 6, retryDelay: 50 });
      removed.push(name);
    } catch (err) {
      failed.push({ name, error: (err as Error).message });
    }
  }
  return { removed, failed };
}
