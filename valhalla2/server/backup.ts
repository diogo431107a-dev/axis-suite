// A copy of the whole database every day, kept beside it.
//
//   <STATE_DIRECTORY>/backups/valhalla2-YYYY-MM-DD.db
//
// Made while Valhalla 2 runs, with SQLite's own `VACUUM INTO`, which writes a consistent, compact
// copy without stopping anything — copying the .db file itself mid-write could catch it half
// changed. The newest few are kept and the rest deleted. A backup taken again on the same day
// replaces that day's. These live on the same disk as the database: they guard against a bad
// change or a broken memory, not a lost disk; copy them elsewhere for that.
import type { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const NAME = /^valhalla2-(\d{4}-\d{2}-\d{2})\.db$/;

export interface BackupInfo {
  file: string;
  day: string;
  bytes: number;
}

/** The backups there are, newest first. */
export function backups(dir: string): BackupInfo[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((name) => ({ name, day: NAME.exec(name)?.[1] }))
    .filter((entry): entry is { name: string; day: string } => entry.day !== undefined)
    .map(({ name, day }) => ({ file: join(dir, name), day, bytes: statSync(join(dir, name)).size }))
    .sort((a, b) => b.day.localeCompare(a.day));
}

const today = (at: Date) => at.toISOString().slice(0, 10);

/** Backs the database up into `dir` as today's file, then keeps only the newest `keep`. */
export function backUp(db: DatabaseSync, dir: string, keep: number, at = new Date()): BackupInfo {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `valhalla2-${today(at)}.db`);
  // VACUUM INTO refuses a file that exists; today's earlier copy gives way to the new one.
  rmSync(file, { force: true });
  db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  for (const old of backups(dir).slice(keep)) rmSync(old.file, { force: true });
  return { file, day: today(at), bytes: statSync(file).size };
}

/** Backs up once a day: now if today has none yet, then every hour checks again. */
export function startDailyBackups(db: DatabaseSync, dir: string, keep: number): () => void {
  const check = () => {
    try {
      if (backups(dir)[0]?.day !== today(new Date())) {
        const made = backUp(db, dir, keep);
        console.log(`Backed up the database to ${made.file}`);
      }
    } catch (err) {
      console.error("The daily backup failed:", err);
    }
  };
  const first = setTimeout(check, 10_000);
  const timer = setInterval(check, 60 * 60_000);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
