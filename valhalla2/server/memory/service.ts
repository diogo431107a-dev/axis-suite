// The Memory page: a companion's files, your own edits to them, their history, and the runs of
// the memory model. Your edits wait their turn behind the memory model (lock.ts) like any other
// change, and are recorded as `manual_edit`.
import type { DatabaseSync } from "node:sqlite";
import { dollarsOf } from "../../shared/price.ts";
import type {
  Attempt,
  Companion,
  MemoryFileView,
  MemoryPage,
  MemoryRunInfo,
  MemoryVersionInfo,
  MemoryVersionView,
} from "../../shared/protocol.ts";
import type { MemoryLimits } from "../config.ts";
import { invalid, notFound } from "../errors.ts";
import { memoryBusy, withMemoryLock } from "./lock.ts";
import { PathError, relativePath } from "./paths.ts";
import { byImportance, bytesOf, lineDiff, MemoryError, type Memory } from "./store.ts";

/** A path the page sent, relative to /memories, checked like the model's. */
export function pagePath(raw: unknown): string {
  try {
    const path = relativePath(`/memories/${typeof raw === "string" ? raw.replace(/^\/+/, "") : ""}`);
    if (path === "") invalid("Name a file");
    return path;
  } catch (err) {
    if (err instanceof PathError) invalid(err.message.replace(/^Error: /, ""));
    throw err;
  }
}

const refused = (err: unknown): never => {
  if (err instanceof MemoryError) invalid(err.message.replace(/^Error: /, ""));
  throw err;
};

export function createMemoryService(db: DatabaseSync, memory: Memory, limits: MemoryLimits) {
  function runs(companion: Companion): MemoryRunInfo[] {
    const rows = db
      .prepare(
        `SELECT r.id, r.kind, r.chat_id, c.title, r.model, r.ok, r.error, r.summary, r.attempts, r.started_at, r.finished_at
         FROM memory_runs r LEFT JOIN chats c ON c.id = r.chat_id
         WHERE r.space = ? ORDER BY r.id DESC LIMIT 30`,
      )
      .all(companion.id) as {
      id: number;
      kind: string;
      chat_id: string | null;
      title: string | null;
      model: string;
      ok: number | null;
      error: string | null;
      summary: string | null;
      attempts: string | null;
      started_at: string;
      finished_at: string | null;
    }[];
    return rows.map((row) => {
      const attempts = row.attempts ? (JSON.parse(row.attempts) as Attempt[]) : [];
      return {
        id: row.id,
        kind: row.kind,
        chatId: row.chat_id,
        chatTitle: row.title,
        model: row.model,
        ok: row.ok === null ? null : row.ok === 1,
        error: row.error,
        summary: row.summary,
        cost: attempts.length > 0 ? dollarsOf({ attempts, usage: null, model: row.model }) : null,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
      };
    });
  }

  const info = (row: {
    id: number;
    op: string;
    source: string;
    at: string;
    content: string | null;
  }): MemoryVersionInfo => ({
    id: row.id,
    op: row.op,
    source: row.source,
    at: row.at,
    size: row.content === null ? null : bytesOf(row.content),
  });

  return {
    page(companion: Companion): MemoryPage {
      return {
        companionId: companion.id,
        files: memory
          .files(companion.id)
          .sort(byImportance)
          .map((file) => ({
            path: file.path,
            size: bytesOf(file.content),
            cap: memory.capFor(file.path),
            updatedAt: file.updatedAt,
          })),
        maxFiles: limits.files,
        runs: runs(companion),
        busy: memoryBusy(companion.id),
      };
    },

    file(companion: Companion, rawPath: unknown): MemoryFileView {
      const path = pagePath(rawPath);
      const file = memory.read(companion.id, path) ?? notFound("memory file");
      return { path, content: file.content, cap: memory.capFor(path) };
    },

    /** Writes a file as you typed it, creating it if needed. */
    save(companion: Companion, rawPath: unknown, content: string): Promise<MemoryFileView> {
      const path = pagePath(rawPath);
      return withMemoryLock(companion.id, () => {
        try {
          memory.write(companion.id, path, content, { op: "manual_edit", source: "manual" });
        } catch (err) {
          refused(err);
        }
        return { path, content, cap: memory.capFor(path) };
      });
    },

    remove(companion: Companion, rawPath: unknown): Promise<void> {
      const path = pagePath(rawPath);
      return withMemoryLock(companion.id, () => {
        if (memory.remove(companion.id, path, { op: "manual_edit", source: "manual" }) === 0) notFound("memory file");
      });
    },

    versions(companion: Companion, rawPath: unknown): MemoryVersionInfo[] {
      return memory.versions(companion.id, pagePath(rawPath)).map(info);
    },

    /** One version of a file, with what it changed from the version before it. */
    version(companion: Companion, id: number): MemoryVersionView {
      const row = db.prepare("SELECT path FROM memory_versions WHERE space = ? AND id = ?").get(companion.id, id) as
        { path: string } | undefined;
      if (!row) notFound("version");
      const all = memory.versions(companion.id, row.path);
      const at = all.findIndex((version) => version.id === id);
      const current = all[at]!;
      const before = all[at + 1]?.content ?? "";
      return { version: info(current), content: current.content, diff: lineDiff(before, current.content ?? "") };
    },

    /** Puts a file back the way a version left it, as a new change. */
    revert(companion: Companion, id: number): Promise<void> {
      return withMemoryLock(companion.id, () => {
        try {
          memory.revert(companion.id, id);
        } catch (err) {
          if (err instanceof MemoryError && err.message === "No such version") notFound("version");
          refused(err);
        }
      });
    },
  };
}

export type MemoryService = ReturnType<typeof createMemoryService>;
