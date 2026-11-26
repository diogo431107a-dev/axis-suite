// How often each user opened each module through Bifrost, so their most-used ones come first.
// Saved to disk next to the sessions; losing it only resets the order.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { USERS } from "./users.ts";

// systemd sets STATE_DIRECTORY (/var/lib/heimdall); locally it falls back to ./data.
const STATE_DIR = process.env.STATE_DIRECTORY ?? "data";
const VISITS_FILE = join(STATE_DIR, "bifrost.json");

type Counts = Record<string, number>;

// username → module → visits
const visits = loadVisits();

function loadVisits(): Map<string, Counts> {
  try {
    const stored = JSON.parse(readFileSync(VISITS_FILE, "utf8")) as Record<string, Counts>;
    // A removed user leaves nothing behind.
    const known = new Set(USERS.map((u) => u.username));
    return new Map(Object.entries(stored).filter(([username]) => known.has(username)));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("Could not read Bifrost's visit counts, starting with none:", err);
    }
    return new Map();
  }
}

function saveVisits(): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    const tmp = `${VISITS_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(visits)), { mode: 0o600 });
    renameSync(tmp, VISITS_FILE);
  } catch (err) {
    console.error("Could not save Bifrost's visit counts:", err);
  }
}

export function recordVisit(username: string, module: string): void {
  const counts = visits.get(username) ?? {};
  counts[module] = (counts[module] ?? 0) + 1;
  visits.set(username, counts);
  saveVisits();
}

export function visitCounts(username: string): Readonly<Counts> {
  return visits.get(username) ?? {};
}
