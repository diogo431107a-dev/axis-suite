// A companion's memory: a handful of Markdown files, kept as rows.
//
// A file is a row of `memory_files`, keyed by its space and its path relative to /memories; a
// directory is only a prefix. A space is a companion's id — or `scratch:<run>`, a copy a run of
// the memory model works on, swapped in whole when it succeeds and thrown away when it doesn't.
//
// Every change writes one row of `memory_versions` with the file as it is afterwards (NULL for a
// delete), so any file can be shown as it was and put back. A revert is one more change, never a
// rewrite of the history.
import type { DatabaseSync } from "node:sqlite";
import type { MemoryLimits } from "../config.ts";
import type { DiffLine } from "../../shared/protocol.ts";
import { transaction } from "../db.ts";
import { absolute, parentsOf, within } from "./paths.ts";

/** A change the memory refuses: too large, too many files, in the way of another. Told to the model as is. */
export class MemoryError extends Error {}

export interface MemoryFile {
  path: string;
  content: string;
  updatedAt: string;
}

export interface Change {
  op: string;
  source: string;
  runId?: number | null;
  at?: string;
}

export interface VersionRow {
  id: number;
  path: string;
  content: string | null;
  op: string;
  source: string;
  runId: number | null;
  at: string;
}

/** The files a new companion starts with: each a heading and what belongs in it, nothing more. */
export const SEED_FILES: readonly { path: string; content: string }[] = [
  {
    path: "character_canon.md",
    content:
      "# Character canon\n\nFacts the character has established about herself that aren't in the profile: invented backstory, tastes, opinions, habits, scars, quirks. Highest priority: never contradict these.\n",
  },
  {
    path: "relationship.md",
    content:
      "# Relationship\n\nHow the bond has changed, nicknames, inside jokes, running gags, rituals, promises made, and where things stand now.\n",
  },
  {
    path: "user.md",
    content:
      "# The user\n\nThe real person behind the persona: name, interests, people in their life, ongoing life events, how they like to be talked to. Real-life facts only; the persona's fictional traits stay in the profile.\n",
  },
  {
    path: "feedback.md",
    content:
      "# Feedback\n\nStanding requests and corrections about how the character writes or behaves, including patterns in why replies were rejected.\n",
  },
  {
    path: "open_threads.md",
    content:
      "# Open threads\n\nUnresolved plot hooks, and real-life things to follow up on. Remove an item once it is resolved.\n",
  },
  {
    path: "world.md",
    content:
      "# World\n\nPlaces, recurring characters and how they feel about the pair, owned items, established lore. Fiction only.\n",
  },
  {
    path: "story/recent.md",
    content: "# Recent episodes\n\nShort summaries (3–6 lines each) of the latest canon chats, newest last.\n",
  },
  {
    path: "story/arcs.md",
    content: "# Story arcs\n\nOlder history, condensed into a paragraph per arc.\n",
  },
];

/** The order files are shown in: the seed files first, as listed there, then the rest by name. */
export function byImportance(a: { path: string }, b: { path: string }): number {
  const rank = (path: string) => {
    const at = SEED_FILES.findIndex((seed) => seed.path === path);
    return at === -1 ? SEED_FILES.length : at;
  };
  return rank(a.path) - rank(b.path) || a.path.localeCompare(b.path);
}

/** A size as a person reads it: 512B, 4.0K, 1.2M. */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / 1024 / 1024).toFixed(1)}M`;
}

export const bytesOf = (text: string): number => Buffer.byteLength(text, "utf8");

/** One person's view of their companions' memory files. `limits` caps what may be written. */
export function createMemory(db: DatabaseSync, limits: MemoryLimits) {
  const capFor = (path: string): number => (path.startsWith("story/") ? limits.storyBytes : limits.fileBytes);

  function read(space: string, path: string): MemoryFile | undefined {
    const row = db
      .prepare("SELECT path, content, updated_at FROM memory_files WHERE space = ? AND path = ?")
      .get(space, path) as { path: string; content: string; updated_at: string } | undefined;
    return row ? { path: row.path, content: row.content, updatedAt: row.updated_at } : undefined;
  }

  function files(space: string): MemoryFile[] {
    const rows = db
      .prepare("SELECT path, content, updated_at FROM memory_files WHERE space = ? ORDER BY path")
      .all(space) as { path: string; content: string; updated_at: string }[];
    return rows.map((row) => ({ path: row.path, content: row.content, updatedAt: row.updated_at }));
  }

  /** The files inside a directory ("" for all of them). */
  const under = (space: string, dir: string): MemoryFile[] => files(space).filter((file) => within(file.path, dir));

  /** Whether `dir` is a directory: something is inside it. The root always is. */
  const isDirectory = (space: string, dir: string): boolean =>
    dir === "" || under(space, dir).some((file) => file.path !== dir);

  function version(space: string, path: string, content: string | null, change: Change, at: string): void {
    db.prepare(
      `INSERT INTO memory_versions (space, path, content, op, source, run_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(space, path, content, change.op, change.source, change.runId ?? null, at);
  }

  /** Refuses a file that would be too large, one too many, or in the way of a directory or file. */
  function check(space: string, path: string, content: string): void {
    const cap = capFor(path);
    const size = bytesOf(content);
    if (size > cap) {
      throw new MemoryError(
        `Error: ${absolute(path)} would be ${humanSize(size)}, over its limit of ${humanSize(cap)}. ` +
          "Condense it first: merge or shorten what it already holds, then try again.",
      );
    }
    if (isDirectory(space, path)) throw new MemoryError(`Error: ${absolute(path)} is a directory`);
    for (const parent of parentsOf(path)) {
      if (read(space, parent)) throw new MemoryError(`Error: ${absolute(parent)} is a file, not a directory`);
    }
    if (!read(space, path)) {
      const { count } = db.prepare("SELECT count(*) AS count FROM memory_files WHERE space = ?").get(space) as {
        count: number;
      };
      if (count >= limits.files) {
        throw new MemoryError(
          `Error: memory already holds ${limits.files} files, the most it may. Merge two files, or put this in one that exists.`,
        );
      }
    }
  }

  /** Creates or replaces a file, after the checks above. */
  function write(space: string, path: string, content: string, change: Change): void {
    const at = change.at ?? new Date().toISOString();
    transaction(db, () => {
      check(space, path, content);
      db.prepare(
        `INSERT INTO memory_files (space, path, content, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (space, path) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
      ).run(space, path, content, at);
      version(space, path, content, change, at);
    });
  }

  /** Deletes a file, or a directory with everything in it. Returns how many files went. */
  function remove(space: string, path: string, change: Change): number {
    const at = change.at ?? new Date().toISOString();
    return transaction(db, () => {
      const gone = under(space, path);
      const drop = db.prepare("DELETE FROM memory_files WHERE space = ? AND path = ?");
      for (const file of gone) {
        drop.run(space, file.path);
        version(space, file.path, null, change, at);
      }
      return gone.length;
    });
  }

  /** Moves a file, or a directory with everything in it. The destination must be free. */
  function rename(space: string, from: string, to: string, change: Change): void {
    const at = change.at ?? new Date().toISOString();
    transaction(db, () => {
      const moving = under(space, from);
      for (const file of moving) {
        const target = to + file.path.slice(from.length);
        db.prepare("DELETE FROM memory_files WHERE space = ? AND path = ?").run(space, file.path);
        version(space, file.path, null, change, at);
        check(space, target, file.content);
        db.prepare("INSERT INTO memory_files (space, path, content, updated_at) VALUES (?, ?, ?, ?)").run(
          space,
          target,
          file.content,
          at,
        );
        version(space, target, file.content, change, at);
      }
    });
  }

  return {
    capFor,
    read,
    files,
    under,
    isDirectory,
    write,
    remove,
    rename,

    /** Gives a new companion its starting files. Does nothing to a companion that has any. */
    seed(space: string, at = new Date().toISOString()): void {
      transaction(db, () => {
        if (files(space).length > 0) return;
        for (const file of SEED_FILES) write(space, file.path, file.content, { op: "seed", source: "seed", at });
      });
    },

    /** Copies one space's files into another, empty one. No versions: nothing changed. */
    copy(from: string, to: string): void {
      db.prepare(
        "INSERT INTO memory_files (space, path, content, updated_at) SELECT ?, path, content, updated_at FROM memory_files WHERE space = ?",
      ).run(to, from);
    },

    /**
     * Puts a scratch space in the place of a companion's files, with the versions it wrote.
     * Call inside the transaction that also records what the run processed.
     */
    swapIn(scratch: string, space: string): void {
      db.prepare("DELETE FROM memory_files WHERE space = ?").run(space);
      db.prepare("UPDATE memory_files SET space = ? WHERE space = ?").run(space, scratch);
      db.prepare("UPDATE memory_versions SET space = ? WHERE space = ?").run(space, scratch);
      db.prepare("UPDATE memory_ops SET space = ? WHERE space = ?").run(space, scratch);
    },

    /**
     * Replaces a companion's files with another space's, recording each file that changed as one
     * version with `change` (and each that went as a deletion). The other space's own step-by-step
     * versions are dropped; its log of commands is kept under the companion. For a rebuild.
     */
    replaceWith(from: string, space: string, change: Change): void {
      const at = change.at ?? new Date().toISOString();
      transaction(db, () => {
        const before = new Map(files(space).map((file) => [file.path, file.content]));
        const after = new Map(files(from).map((file) => [file.path, file.content]));
        for (const path of new Set([...before.keys(), ...after.keys()])) {
          const content = after.get(path) ?? null;
          if (content !== (before.get(path) ?? null)) version(space, path, content, change, at);
        }
        db.prepare("DELETE FROM memory_files WHERE space = ?").run(space);
        db.prepare("UPDATE memory_files SET space = ?, updated_at = ? WHERE space = ?").run(space, at, from);
        db.prepare("DELETE FROM memory_versions WHERE space = ?").run(from);
        db.prepare("UPDATE memory_ops SET space = ? WHERE space = ?").run(space, from);
      });
    },

    /** Throws a scratch space away, with every version it wrote. Its log of commands stays. */
    drop(scratch: string, keepOpsAs: string): void {
      db.prepare("DELETE FROM memory_files WHERE space = ?").run(scratch);
      db.prepare("DELETE FROM memory_versions WHERE space = ?").run(scratch);
      db.prepare("UPDATE memory_ops SET space = ? WHERE space = ?").run(keepOpsAs, scratch);
    },

    /** Every change to one file, newest first. */
    versions(space: string, path: string): VersionRow[] {
      const rows = db
        .prepare(
          `SELECT id, path, content, op, source, run_id, created_at FROM memory_versions
           WHERE space = ? AND path = ? ORDER BY id DESC`,
        )
        .all(space, path) as {
        id: number;
        path: string;
        content: string | null;
        op: string;
        source: string;
        run_id: number | null;
        created_at: string;
      }[];
      return rows.map((row) => ({
        id: row.id,
        path: row.path,
        content: row.content,
        op: row.op,
        source: row.source,
        runId: row.run_id,
        at: row.created_at,
      }));
    },

    /** Puts a file back the way one of its versions left it — as one more change. */
    revert(space: string, versionId: number, source = "manual"): void {
      const row = db
        .prepare("SELECT path, content FROM memory_versions WHERE space = ? AND id = ?")
        .get(space, versionId) as { path: string; content: string | null } | undefined;
      if (!row) throw new MemoryError("No such version");
      if (row.content === null) {
        if (read(space, row.path)) remove(space, row.path, { op: "revert", source });
        return;
      }
      write(space, row.path, row.content, { op: "revert", source });
    },
  };
}

export type Memory = ReturnType<typeof createMemory>;

/** What changed between two texts, line by line (longest common subsequence). */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  const n = a.length;
  const m = b.length;
  // lengths[i][j]: the longest common run of a[i..] and b[j..].
  const lengths: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i]![j] = a[i] === b[j] ? lengths[i + 1]![j + 1]! + 1 : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
      out.push({ kind: "removed", text: a[i++]! });
    } else {
      out.push({ kind: "added", text: b[j++]! });
    }
  }
  while (i < n) out.push({ kind: "removed", text: a[i++]! });
  while (j < m) out.push({ kind: "added", text: b[j++]! });
  return out;
}
