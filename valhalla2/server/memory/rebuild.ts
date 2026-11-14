// Rebuilding a companion's memory from every chat.
//
// For when the memory went wrong, or a better memory model is out, or the instructions changed:
// the files start again from their seeds, in a space of their own, and every chat's selected path
// (deleted messages excluded) is replayed through the memory model in the order the chats were
// held, a window's worth at a time, with the chat's mode and the reasons you gave for rejecting
// replies. The old memory is untouched until the very end, when the new one replaces it in one
// transaction, each changed file recorded as a `rebuild` version — so the old one is still in the
// history. If any step fails, nothing changes.
import type { ChatMode, Companion, Message, RunOutcome } from "../../shared/protocol.ts";
import { CONSOLIDATION_MODES, promptOf, REBUILD_NOTE } from "../../shared/prompts.ts";
import { createTree } from "../chat/tree.ts";
import { transaction } from "../db.ts";
import { promptFor } from "./consolidate.ts";
import { tokensOf } from "./history.ts";
import { withMemoryLock } from "./lock.ts";
import { abandonRun, finishRun, runStep, type RunDeps } from "./run.ts";

/** Splits a path into parts of about `budget` tokens, each at least one message. */
export function partsOf(path: Message[], budget: number): Message[][] {
  const parts: Message[][] = [];
  let part: Message[] = [];
  let size = 0;
  for (const message of path) {
    const cost = tokensOf(message);
    if (part.length > 0 && size + cost > budget) {
      parts.push(part);
      part = [];
      size = 0;
    }
    part.push(message);
    size += cost;
  }
  if (part.length > 0) parts.push(part);
  return parts;
}

/** Rebuilds one companion's memory from all its chats. Never throws for a failed run. */
export function rebuild(deps: RunDeps & { partTokens: number }, companion: Companion): Promise<RunOutcome> {
  return withMemoryLock(companion.id, async (): Promise<RunOutcome> => {
    const { db, memory } = deps;
    const space = `rebuild:${companion.id}:${Date.now()}`;
    memory.seed(space);

    const chats = db
      .prepare("SELECT id, title, mode FROM chats WHERE companion_id = ? ORDER BY created_at, id")
      .all(companion.id) as { id: string; title: string; mode: ChatMode }[];
    const steps: Extract<Awaited<ReturnType<typeof runStep>>, { ok: true }>[] = [];
    const filed: { chatId: string; ids: number[]; feedback: number[] }[] = [];

    for (const chat of chats) {
      const path = createTree(db, chat.id).activePath();
      if (path.length === 0) continue;
      const feedback = db
        .prepare(
          "SELECT id, parent_id, reason FROM swipe_feedback WHERE chat_id = ? AND reason IS NOT NULL ORDER BY id",
        )
        .all(chat.id) as { id: number; parent_id: number | null; reason: string }[];
      const parts = partsOf(path, deps.partTokens);
      for (const [at, part] of parts.entries()) {
        const last = at === parts.length - 1;
        const step = await runStep(deps, {
          companion,
          kind: "rebuild",
          chatId: chat.id,
          work: space,
          source: "rebuild",
          mode: chat.mode,
          system: `${promptOf(companion, "consolidation")}\n\n${CONSOLIDATION_MODES[chat.mode]}\n\n${REBUILD_NOTE}`,
          prompt: promptFor(companion, memory.files(space), {
            chat: { ...chat, companion_id: companion.id, consolidated_mode: null },
            path,
            fresh: part,
            corrections: [],
            feedback: last ? feedback : [],
            modeChanged: false,
            needed: true,
          }),
        });
        if (!step.ok) {
          memory.drop(space, companion.id);
          for (const done of steps)
            abandonRun(db, done.runId, "A later step of this rebuild failed, so none of it was kept.");
          return { kind: "failed", runId: step.runId, error: `The rebuild stopped at "${chat.title}": ${step.error}` };
        }
        finishRun(db, step);
        steps.push(step);
      }
      filed.push({ chatId: chat.id, ids: path.map((message) => message.id), feedback: feedback.map((row) => row.id) });
    }

    const at = new Date().toISOString();
    transaction(db, () => {
      memory.replaceWith(space, companion.id, { op: "rebuild", source: "rebuild", at });
      // What is in memory now is exactly every chat's selected path.
      for (const chat of chats) {
        db.prepare("UPDATE messages SET consolidated_at = NULL, needs_correction = 0 WHERE chat_id = ?").run(chat.id);
        db.prepare("UPDATE swipe_feedback SET consolidated_at = NULL WHERE chat_id = ?").run(chat.id);
        db.prepare("UPDATE chats SET consolidated_mode = mode, memory_snapshot = NULL WHERE id = ?").run(chat.id);
      }
      const mark = db.prepare("UPDATE messages SET consolidated_at = ? WHERE id = ?");
      const markFeedback = db.prepare("UPDATE swipe_feedback SET consolidated_at = ? WHERE id = ?");
      for (const chat of filed) {
        for (const id of chat.ids) mark.run(at, id);
        for (const id of chat.feedback) markFeedback.run(at, id);
      }
    });
    const summary =
      filed.length === 0
        ? "There were no chats to rebuild from: memory is back to its empty files."
        : `Rebuilt from ${filed.length} ${filed.length === 1 ? "chat" : "chats"} in ${steps.length} ${steps.length === 1 ? "step" : "steps"}.`;
    return { kind: "done", runId: steps.at(-1)?.runId ?? 0, summary };
  });
}
