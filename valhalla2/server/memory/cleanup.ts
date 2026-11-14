// Tidying a companion's memory every so often.
//
// Consolidation works one chat at a time, so the files slowly gather near-duplicates, facts that
// later chats contradicted, and summaries that could be shorter. Every N consolidations (or once a
// week, if there were any), the memory model reads all the files at once and tidies them: merges
// duplicates, lets the most recent fact win — except in character_canon.md, where a real conflict
// is listed under `## Conflicts` rather than silently rewritten — and condenses each file toward
// about 70% of its limit. It keeps the files as they are: one that adds, renames or deletes a file
// is not kept. Like every run, it works on a copy, swapped in only when it succeeds.
import type { DatabaseSync } from "node:sqlite";
import type { Companion, RunOutcome } from "../../shared/protocol.ts";
import { promptOf } from "../../shared/prompts.ts";
import { transaction } from "../db.ts";
import { withMemoryLock } from "./lock.ts";
import { finishRun, runStep, type RunDeps } from "./run.ts";
import { byImportance, bytesOf, humanSize } from "./store.ts";

export interface CleanupRule {
  /** Tidy after this many successful consolidations. */
  every: number;
  /** …or after this many days, if memory changed at all. */
  days: number;
}

/** Whether a companion's memory is due a tidy-up. */
export function cleanupDue(db: DatabaseSync, companionId: string, rule: CleanupRule, now = Date.now()): boolean {
  const last = db
    .prepare("SELECT id, ok, started_at FROM memory_runs WHERE space = ? AND kind = 'cleanup' ORDER BY id DESC LIMIT 1")
    .get(companionId) as { id: number; ok: number | null; started_at: string } | undefined;
  const since = db
    .prepare(
      `SELECT count(*) AS count, min(started_at) AS first FROM memory_runs
       WHERE space = ? AND kind = 'consolidate' AND ok = 1 AND id > ?`,
    )
    .get(companionId, last?.id ?? 0) as { count: number; first: string | null };
  if (since.count === 0) return false;
  // A tidy-up that failed is not tried again until a consolidation has come after it — which the
  // count above already requires — and then only by the same rule.
  if (since.count >= rule.every) return true;
  const from = Date.parse(last?.started_at ?? since.first ?? new Date(now).toISOString());
  return now - from >= rule.days * 24 * 60 * 60_000;
}

/** Tidies one companion's memory. Never throws for a failed run: it is recorded. */
export function cleanup(deps: RunDeps, companion: Companion): Promise<RunOutcome> {
  return withMemoryLock(companion.id, async (): Promise<RunOutcome> => {
    const { db, memory } = deps;
    const files = memory.files(companion.id).sort(byImportance);
    if (files.length === 0) return { kind: "nothing", reason: "This companion's memory is empty" };

    const shown = files
      .map(
        (file) =>
          `<memory_file path="${file.path}" size="${humanSize(bytesOf(file.content))}" limit="${humanSize(memory.capFor(file.path))}">\n` +
          `${file.content.replace(/\n$/, "")}\n</memory_file>`,
      )
      .join("\n\n");

    const scratch = `scratch:${companion.id}:${Date.now()}`;
    memory.copy(companion.id, scratch);
    const step = await runStep(deps, {
      companion,
      kind: "cleanup",
      chatId: null,
      work: scratch,
      source: "cleanup",
      mode: "canon",
      system: promptOf(companion, "cleanup"),
      prompt: `<current_memory>\n${shown}\n</current_memory>`,
    });
    if (!step.ok) {
      memory.drop(scratch, companion.id);
      return { kind: "failed", runId: step.runId, error: step.error };
    }

    const before = files.map((file) => file.path).join("\n");
    const after = memory
      .files(scratch)
      .sort(byImportance)
      .map((file) => file.path)
      .join("\n");
    if (before !== after) {
      memory.drop(scratch, companion.id);
      const error = "The tidy-up added, renamed or deleted files, which it may not do, so none of it was kept.";
      db.prepare("UPDATE memory_runs SET ok = 0, error = ?, finished_at = ? WHERE id = ?").run(
        error,
        new Date().toISOString(),
        step.runId,
      );
      return { kind: "failed", runId: step.runId, error };
    }

    transaction(db, () => {
      memory.swapIn(scratch, companion.id);
      finishRun(db, step);
      // Every chat reads memory afresh the next time its prompt changes anyway.
    });
    return { kind: "done", runId: step.runId, summary: step.text };
  });
}
