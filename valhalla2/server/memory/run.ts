// One run of the memory model: a consolidation, a tidy-up, or one step of a rebuild.
//
// Every run is a row of `memory_runs`, written before it starts, so the Memory page can say that
// something is running and later what it changed, what it cost, or why it failed. The run works on
// a space of memory files it is handed (a scratch copy, or a rebuild's fresh files); whether those
// are kept is up to the caller, which finishes a successful run inside the transaction that keeps
// them (`finishRun`).
import { providerOf, type ChatMode, type Companion } from "../../shared/protocol.ts";
import type { MemoryRunner } from "../claude/memory.ts";
import type { MemoryLimits } from "../config.ts";
import type { DatabaseSync } from "node:sqlite";
import { memoryTool } from "./tool.ts";
import type { Memory } from "./store.ts";

export interface RunDeps {
  db: DatabaseSync;
  memory: Memory;
  limits: MemoryLimits;
  run: MemoryRunner;
  maxIterations: number;
}

export type RunKind = "consolidate" | "cleanup" | "rebuild";

export interface RunSpec {
  companion: Companion;
  kind: RunKind;
  chatId: string | null;
  /** The space of files the model reads and writes. */
  work: string;
  /** What each change is recorded as coming from. */
  source: string;
  /** The rules the tool applies: a one-shot may not write world.md or story/. */
  mode: ChatMode;
  /** Whether a canon chat switched to one-shot is being taken back out of world.md and story/. */
  takeBack?: boolean;
  system: string;
  prompt: string;
}

export type StepResult =
  { ok: true; runId: number; text: string; attempts: unknown[] } | { ok: false; runId: number; error: string };

const now = () => new Date().toISOString();

/** Runs the memory model once. A failed run is recorded as failed here; a good one is left open. */
export async function runStep(deps: RunDeps, spec: RunSpec): Promise<StepResult> {
  const { db, memory, limits } = deps;
  // The one place the memory model runs. Only a companion with memory ever gets here, and only
  // with a memory model of its own API; this holds that even if a caller forgot, so nothing of a
  // companion's can reach another API.
  if (!spec.companion.memory) {
    throw new Error(`${spec.companion.name} has no memory, so the memory model was not run`);
  }
  if (providerOf(spec.companion.settings.memoryModel) !== spec.companion.provider) {
    throw new Error(
      `${spec.companion.settings.memoryModel} isn't a model of ${spec.companion.name}'s API, so the memory model was not run`,
    );
  }
  const { lastInsertRowid } = db
    .prepare("INSERT INTO memory_runs (space, chat_id, kind, model, started_at) VALUES (?, ?, ?, ?, ?)")
    .run(spec.companion.id, spec.chatId, spec.kind, spec.companion.settings.memoryModel, now());
  const runId = Number(lastInsertRowid);

  const fail = (error: string, attempts: unknown[] | null = null): StepResult => {
    db.prepare("UPDATE memory_runs SET ok = 0, error = ?, attempts = ?, finished_at = ? WHERE id = ?").run(
      error,
      attempts === null ? null : JSON.stringify(attempts),
      now(),
      runId,
    );
    return { ok: false, runId, error };
  };

  let result;
  try {
    result = await deps.run({
      system: spec.system,
      prompt: spec.prompt,
      tool: memoryTool({
        db,
        memory,
        limits,
        space: spec.work,
        source: spec.source,
        runId,
        chatId: spec.chatId,
        mode: spec.mode,
        takeBack: spec.takeBack ?? false,
      }),
      settings: spec.companion.settings,
      maxIterations: deps.maxIterations,
      cacheKey: `memory-run:${runId}`,
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  if (result.stopReason === "refusal") {
    const category = result.stopDetails?.category ? ` (${result.stopDetails.category})` : "";
    return fail(
      `The API declined to update memory${category}. ${result.stopDetails?.explanation ?? ""}`.trim(),
      result.attempts,
    );
  }
  if (result.stopReason !== "end_turn" && result.stopReason !== "stop_sequence") {
    return fail(
      result.stopReason === "tool_use"
        ? `The memory model used all ${deps.maxIterations} of its steps before finishing.`
        : `The memory model stopped early (${result.stopReason}).`,
      result.attempts,
    );
  }
  return { ok: true, runId, text: result.text, attempts: result.attempts };
}

/** Marks a successful run as finished. Call inside the transaction that keeps what it did. */
export function finishRun(db: DatabaseSync, step: Extract<StepResult, { ok: true }>, at = now()): void {
  db.prepare("UPDATE memory_runs SET ok = 1, summary = ?, attempts = ?, finished_at = ? WHERE id = ?").run(
    step.text || null,
    JSON.stringify(step.attempts),
    at,
    step.runId,
  );
}

/** Marks a run that succeeded but whose work was not kept (a rebuild stopped later on, say). */
export function abandonRun(db: DatabaseSync, runId: number, why: string): void {
  db.prepare("UPDATE memory_runs SET ok = 0, error = ?, finished_at = ? WHERE id = ? AND (ok IS NULL OR ok = 1)").run(
    why,
    now(),
    runId,
  );
}
