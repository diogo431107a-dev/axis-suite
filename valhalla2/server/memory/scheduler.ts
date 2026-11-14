// When chats are folded into memory, without anyone having to ask.
//
//   - when you press "Remember now" (index.ts calls `now`);
//   - when the oldest turns of a long chat slide out of the window (`soon`, from turn.ts);
//   - when you open a new chat with a companion whose other chats aren't all in memory yet
//     (`othersOf`): the greeting waits for them, so it is written knowing everything;
//   - when a chat has been quiet for a while (`idleMinutes`), checked once a minute — which also
//     catches whatever was left when the server last stopped.
//
// No cron, no daemon: one timer in this process. A chat whose last run failed (declined, say) is
// not retried by the timer until something in it changes; "Remember now" always tries.
import type { Companion } from "../../shared/protocol.ts";
import { companionOf } from "../companions.ts";
import { consolidate, hasPending, type ConsolidateDeps, type RunOutcome } from "./consolidate.ts";

export interface SchedulerDeps extends ConsolidateDeps {
  idleMinutes: number;
}

export function createScheduler(deps: SchedulerDeps) {
  const { db } = deps;
  const inFlight = new Map<string, Promise<RunOutcome>>();

  const companionOfChat = (chatId: string): Companion | null => {
    const row = db
      .prepare(
        `SELECT p.id, p.name, p.profile, p.settings, p.prompts, p.created_at, p.updated_at
         FROM chats c JOIN companions p ON p.id = c.companion_id WHERE c.id = ?`,
      )
      .get(chatId) as Parameters<typeof companionOf>[0] | undefined;
    return row ? companionOf(row) : null;
  };

  /** Folds a chat into memory now, or joins the run already doing it. */
  function now(chatId: string): Promise<RunOutcome> {
    const running = inFlight.get(chatId);
    if (running) return running;
    const companion = companionOfChat(chatId);
    if (!companion) return Promise.resolve({ kind: "nothing", reason: "No such chat" });
    const run = consolidate(deps, chatId, companion).finally(() => inFlight.delete(chatId));
    inFlight.set(chatId, run);
    return run;
  }

  /** Folds a chat into memory in the background. */
  function soon(chatId: string): void {
    now(chatId).then(
      (outcome) => {
        if (outcome.kind === "failed") console.error(`Memory of chat ${chatId} was not updated: ${outcome.error}`);
      },
      (err: unknown) => console.error(`Memory of chat ${chatId} could not be updated:`, err),
    );
  }

  /** Starts on every other chat of the companion that memory hasn't caught up with. */
  function othersOf(companionId: string, exceptChatId: string): void {
    const ids = db
      .prepare("SELECT id FROM chats WHERE companion_id = ? AND id != ?")
      .all(companionId, exceptChatId) as {
      id: string;
    }[];
    for (const { id } of ids) if (hasPending(db, id)) soon(id);
  }

  /** Every chat quiet for `idleMinutes` with something memory doesn't have, unless its last try failed since. */
  function sweep(at = Date.now()): string[] {
    const cutoff = new Date(at - deps.idleMinutes * 60_000).toISOString();
    const rows = db
      .prepare(
        `SELECT c.id FROM chats c
         WHERE c.last_activity_at < ?
           AND NOT EXISTS (
             SELECT 1 FROM memory_runs r
             WHERE r.chat_id = c.id AND r.ok = 0 AND r.started_at > c.last_activity_at
               AND r.id = (SELECT max(id) FROM memory_runs WHERE chat_id = c.id))`,
      )
      .all(cutoff) as { id: string }[];
    const started: string[] = [];
    for (const { id } of rows) {
      if (inFlight.has(id) || !hasPending(db, id)) continue;
      soon(id);
      started.push(id);
    }
    return started;
  }

  let timer: NodeJS.Timeout | null = null;
  return {
    now,
    soon,
    othersOf,
    sweep,
    /** Whether a chat is being folded into memory right now. */
    running: (chatId: string) => inFlight.has(chatId),
    start(): void {
      timer = setInterval(() => sweep(), 60_000);
      timer.unref();
      // Whatever was left when the server last stopped.
      setTimeout(() => sweep(), 5_000).unref();
    },
    stop(): void {
      if (timer) clearInterval(timer);
    },
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;
