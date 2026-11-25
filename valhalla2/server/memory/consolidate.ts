// Folding a chat into its companion's memory: the only way memory is written by a model.
//
// It reads the chat's selected path, never a reply that wasn't selected, and gives the memory
// model what changed since last time:
//
//   - the messages on the path not yet in memory;
//   - the ones that were, but have since been edited, deleted, or left on another branch, with
//     what took their place, so whatever came only from them can be taken back;
//   - the reasons you gave for rejecting replies;
//   - the praise you gave liked replies, and any you took back (see likes.ts);
//   - the chat's mode, and a note when it changed since the chat was last filed.
//
// The model works with the memory tool on a scratch copy of the companion's files. Only when it
// finishes is the copy swapped in, in one transaction with the marks that say what was processed;
// a run that fails, is declined or runs out of steps changes nothing and can run again. With
// nothing new it does nothing at all, so running it twice is the same as running it once.
import type { DatabaseSync } from "node:sqlite";
import {
  blockText,
  type ChatMode,
  type Companion,
  type Message,
  type QuietTopic,
  type RunOutcome,
} from "../../shared/protocol.ts";
import { CONSOLIDATION_MODES, promptOf } from "../../shared/prompts.ts";
import { transaction } from "../db.ts";
import { createTree } from "../chat/tree.ts";
import { markFiled, praiseFor, type Praise } from "../likes.ts";
import { quietBlock, quietOf } from "../quiet.ts";
import { renderFiles } from "./render.ts";
import { withMemoryLock } from "./lock.ts";
import type { Memory } from "./store.ts";
import { finishRun, runStep, type RunDeps } from "./run.ts";

export type ConsolidateDeps = RunDeps;

export type { RunOutcome };

interface Correction {
  id: number;
  role: Message["role"];
  what: "deleted" | "edited" | "abandoned" | "restored";
  before: string;
  after: string | null;
}

const textOf = (content: string): string =>
  (JSON.parse(content) as { type: string; text?: string }[]).map((block) => blockText(block)).join("");

/** How many already-filed messages before the new ones are shown again, for context. */
const CONTEXT_MESSAGES = 6;

/** What there is to fold into memory for one chat, or nothing. */
export function pendingFor(db: DatabaseSync, chatId: string) {
  const chat = db
    .prepare("SELECT id, companion_id, title, mode, consolidated_mode FROM chats WHERE id = ?")
    .get(chatId) as
    { id: string; companion_id: string; title: string; mode: ChatMode; consolidated_mode: ChatMode | null } | undefined;
  if (!chat) return null;
  const tree = createTree(db, chatId);
  const path = tree.activePath();
  const onPath = new Set(path.map((message) => message.id));
  const fresh = path.filter(
    (message) =>
      (
        db.prepare("SELECT consolidated_at FROM messages WHERE id = ?").get(message.id) as {
          consolidated_at: string | null;
        }
      ).consolidated_at === null,
  );

  const flagged = db
    .prepare(
      `SELECT id, parent_id, role, content, deleted_at, consolidated_at FROM messages
       WHERE chat_id = ? AND needs_correction = 1 ORDER BY id`,
    )
    .all(chatId) as {
    id: number;
    parent_id: number | null;
    role: Message["role"];
    content: string;
    deleted_at: string | null;
    consolidated_at: string | null;
  }[];
  const corrections: Correction[] = flagged.map((row) => {
    // What memory saw: the words before the first edit made after it was filed.
    const revision = db
      .prepare("SELECT content FROM message_revisions WHERE message_id = ? AND replaced_at >= ? ORDER BY id LIMIT 1")
      .get(row.id, row.consolidated_at ?? "") as { content: string } | undefined;
    const before = textOf(revision?.content ?? row.content);
    if (row.deleted_at) return { id: row.id, role: row.role, what: "deleted", before, after: null };
    if (onPath.has(row.id)) {
      return revision
        ? { id: row.id, role: row.role, what: "edited", before, after: textOf(row.content) }
        : { id: row.id, role: row.role, what: "restored", before, after: null };
    }
    const instead = path.find((message) => message.parentId === row.parent_id && message.role === row.role);
    return {
      id: row.id,
      role: row.role,
      what: "abandoned",
      before,
      after: instead ? instead.content.map(blockText).join("") : null,
    };
  });

  const feedback = db
    .prepare(
      `SELECT id, parent_id, reason FROM swipe_feedback
       WHERE chat_id = ? AND reason IS NOT NULL AND consolidated_at IS NULL ORDER BY id`,
    )
    .all(chatId) as { id: number; parent_id: number | null; reason: string }[];

  const praise = praiseFor(db, chatId, onPath);

  const modeChanged = chat.consolidated_mode !== null && chat.consolidated_mode !== chat.mode;
  const needed =
    fresh.length > 0 ||
    corrections.some((c) => c.what !== "restored") ||
    feedback.length > 0 ||
    praise.length > 0 ||
    modeChanged;
  return { chat, path, fresh, corrections, feedback, praise, modeChanged, needed };
}

const cutShort = (words: string): string => (words.length > 300 ? `${words.slice(0, 300).trimEnd()}…` : words);

/** The praise you gave, and took back, as the memory model reads it. */
function praiseBlocks(praise: Praise[]): string[] {
  const parts: string[] = [];
  const quote = (words: string) => `"${words.replaceAll("\n", "\n  ")}"`;
  const given = praise.filter((p) => p.kind !== "withdrawn");
  if (given.length > 0) {
    const lines = given.map((p) => {
      const about = p.isGreeting ? "A greeting" : "A reply";
      const where = p.onPath
        ? ""
        : " (a version that is not on the selected path: it is about the writing only, so take no facts or events from it)";
      const out = [`- ${about} the user liked${where}:`, `  ${quote(p.text)}`, `  The user said: "${p.comment}"`];
      if (p.kind === "changed") out.push(`  Before, the user had said: "${p.before}"`);
      for (const other of p.passedOver) out.push(`  Another version of it: ${quote(other)}`);
      return out.join("\n");
    });
    parts.push(
      "<praise>\nThe user liked these replies and said what made them good: what to keep doing.\n" +
        `${lines.join("\n")}\n</praise>`,
    );
  }
  const withdrawn = praise.filter((p) => p.kind === "withdrawn");
  if (withdrawn.length > 0) {
    const lines = withdrawn.map((p) => `- "${p.before}", about the reply: ${quote(cutShort(p.text))}`);
    parts.push(
      "<withdrawn_praise>\nThe user took back this praise. Remove what came only from it.\n" +
        `${lines.join("\n")}\n</withdrawn_praise>`,
    );
  }
  return parts;
}

/** Whether a chat has anything memory doesn't have yet. */
export const hasPending = (db: DatabaseSync, chatId: string): boolean => pendingFor(db, chatId)?.needed ?? false;

/** What the memory model is given to read, besides its instructions. */
export function promptFor(
  companion: Companion,
  files: ReturnType<Memory["files"]>,
  pending: NonNullable<ReturnType<typeof pendingFor>>,
  quiet: QuietTopic[] = [],
): string {
  const { chat, path, fresh, corrections, feedback, praise, modeChanged } = pending;
  const who = (role: Message["role"]) => (role === "user" ? "USER" : companion.name.toUpperCase());
  const said = (message: Message) => `[${who(message.role)}] ${message.content.map(blockText).join("").trim()}`;
  const parts: string[] = [];

  parts.push(`<current_memory>\n${renderFiles(files)}\n</current_memory>`);
  parts.push(`<chat title="${chat.title.replaceAll('"', "'")}" mode="${chat.mode}"/>`);

  if (modeChanged) {
    parts.push(
      `<mode_change>This chat was filed into memory as ${chat.consolidated_mode} and is now ${chat.mode}. ` +
        "Re-file what it put in memory to suit its new mode. Its whole selected path is below.</mode_change>",
    );
  }

  const firstNew = fresh[0] ? path.indexOf(fresh[0]) : path.length;
  const context = modeChanged
    ? path.slice(0, firstNew)
    : path.slice(Math.max(0, firstNew - CONTEXT_MESSAGES), firstNew);
  if (context.length > 0) {
    parts.push(`<already_in_memory>\n${context.map(said).join("\n\n")}\n</already_in_memory>`);
  }
  if (fresh.length > 0) parts.push(`<new_messages>\n${fresh.map(said).join("\n\n")}\n</new_messages>`);

  const changed = corrections.filter((c) => c.what !== "restored");
  if (changed.length > 0) {
    const lines = changed.map((c) => {
      const by = `A message by ${who(c.role)}`;
      if (c.what === "deleted") return `- ${by} was deleted. It said: "${c.before}"`;
      if (c.what === "edited") return `- ${by} was edited. It said: "${c.before}"\n  It now says: "${c.after}"`;
      return c.after === null
        ? `- ${by} was left on an abandoned branch, with nothing in its place. It said: "${c.before}"`
        : `- ${by} was left on an abandoned branch. It said: "${c.before}"\n  The selected path has instead: "${c.after}"`;
    });
    parts.push(`<corrections>\n${lines.join("\n")}\n</corrections>`);
  }

  if (feedback.length > 0) {
    const lines = feedback.map((row) => {
      const about = row.parent_id === null ? "the greeting" : "replies to one of the user's messages";
      return `- About ${about}: "${row.reason}"`;
    });
    parts.push(`<rejection_reasons>\n${lines.join("\n")}\n</rejection_reasons>`);
  }
  parts.push(...praiseBlocks(praise));
  parts.push(...quietBlock(quiet));
  return parts.join("\n\n");
}

/**
 * Folds one chat into its companion's memory. Waits its turn behind anything else writing that
 * memory. Never throws for a failed run: the run is recorded with what went wrong.
 */
export function consolidate(deps: ConsolidateDeps, chatId: string, companion: Companion): Promise<RunOutcome> {
  return withMemoryLock(companion.id, async (): Promise<RunOutcome> => {
    const { db, memory } = deps;
    const pending = pendingFor(db, chatId);
    if (!pending) return { kind: "nothing", reason: "No such chat" };
    const now = () => new Date().toISOString();

    if (!pending.needed) {
      // A message that came back onto the path unchanged needs no correction, only its mark lifted.
      const restored = pending.corrections.filter((c) => c.what === "restored");
      for (const c of restored) db.prepare("UPDATE messages SET needs_correction = 0 WHERE id = ?").run(c.id);
      return { kind: "nothing", reason: "Memory already has everything in this chat" };
    }

    const scratch = `scratch:${companion.id}:${Date.now()}`;
    memory.copy(companion.id, scratch);
    const step = await runStep(deps, {
      companion,
      kind: "consolidate",
      chatId,
      work: scratch,
      source: `consolidate:${chatId}`,
      mode: pending.chat.mode,
      system: `${promptOf(companion, "consolidation")}

${CONSOLIDATION_MODES[pending.chat.mode]}`,
      prompt: promptFor(companion, memory.files(companion.id), pending, quietOf(deps.db, companion.id)),
    });
    if (!step.ok) {
      memory.drop(scratch, companion.id);
      return { kind: "failed", runId: step.runId, error: step.error };
    }

    transaction(db, () => {
      const at = now();
      memory.swapIn(scratch, companion.id);
      const filed = db.prepare("UPDATE messages SET consolidated_at = ?, needs_correction = 0 WHERE id = ?");
      for (const message of pending.fresh) filed.run(at, message.id);
      for (const c of pending.corrections) {
        if (c.what === "edited") filed.run(at, c.id);
        else if (c.what === "restored") db.prepare("UPDATE messages SET needs_correction = 0 WHERE id = ?").run(c.id);
        // Deleted or left behind: no longer in memory, so new again should it come back.
        else db.prepare("UPDATE messages SET consolidated_at = NULL, needs_correction = 0 WHERE id = ?").run(c.id);
      }
      for (const row of pending.feedback) {
        db.prepare("UPDATE swipe_feedback SET consolidated_at = ? WHERE id = ?").run(at, row.id);
      }
      markFiled(db, pending.praise, at);
      db.prepare("UPDATE chats SET consolidated_mode = mode WHERE id = ?").run(chatId);
      finishRun(db, step, at);
    });
    return { kind: "done", runId: step.runId, summary: step.text };
  });
}
