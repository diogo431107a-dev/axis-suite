// One-off work as the server starts, before anything is served.
import type { DatabaseSync } from "node:sqlite";
import { knownUsers } from "@axis-suite/heimdall-client/server";
import { removeUnknownOwners } from "./db.ts";

/**
 * A run of the memory model the server was stopped in the middle of changed nothing (it worked on
 * a scratch copy); clear the copy away and say so on the run.
 */
export function closeCutShortRuns(db: DatabaseSync): void {
  const leftover = db.prepare("SELECT id FROM memory_runs WHERE ok IS NULL").all() as { id: number }[];
  for (const table of ["memory_files", "memory_versions"]) {
    db.prepare(`DELETE FROM ${table} WHERE space LIKE 'scratch:%' OR space LIKE 'rebuild:%'`).run();
  }
  db.prepare(
    "UPDATE memory_runs SET ok = 0, error = 'The server stopped before this run finished; nothing was changed.', finished_at = ? WHERE ok IS NULL",
  ).run(new Date().toISOString());
  if (leftover.length > 0)
    console.log(`${leftover.length} memory run(s) cut short by the last stop; nothing was changed`);
}

/**
 * Someone removed from Heimdall leaves nothing behind. Without the list (development, or Heimdall
 * not installed yet) nothing is deleted.
 */
export function removeGoneUsers(db: DatabaseSync): void {
  const known = knownUsers();
  if (!known) return;
  for (const name of removeUnknownOwners(db, known)) {
    console.log(`Deleted the companions and chats of ${name}, who is no longer in Heimdall`);
  }
}
