// When the memory model runs, without anyone having to ask.
//
// A chat is folded into memory:
//   - when you press "Remember now" (index.ts calls `now`);
//   - when the oldest turns of a long chat slide out of the window (`now`, from turn.ts: the reply
//     waits for it, so the chat's next look at memory holds them);
//   - when you open a new chat with a companion whose other chats aren't all in memory yet
//     (`othersOf`): the greeting waits for them, so it is written knowing everything;
//   - when a chat has been quiet for a while (`idleMinutes`), checked once a minute — which also
//     catches whatever was left when the server last stopped.
// A companion's memory is tidied after every `cleanup.every` consolidations, or after
// `cleanup.days` if it changed at all (checked after each consolidation and by the same timer),
// and when you press "Tidy up now". It is rebuilt only when you ask, and a Grok companion without
// memory gets it, by the same rebuild, only when you turn it on.
//
// No cron, no daemon: one timer in this process. A chat whose last run failed (declined, say) is
// not retried by the timer until something in it changes; the buttons always try.
import type { Companion, RunOutcome } from "../../shared/protocol.ts";
import { companionColumns, companionOf } from "../companions.ts";
import { cleanup, cleanupDue, type CleanupRule } from "./cleanup.ts";
import { consolidate, hasPending } from "./consolidate.ts";
import { rebuild } from "./rebuild.ts";
import type { RunDeps } from "./run.ts";

export interface SchedulerDeps extends RunDeps {
  idleMinutes: number;
  cleanup: CleanupRule;
  /** About how many tokens of a chat one rebuild step reads. */
  partTokens: number;
}

// Only a companion with memory: for one without, every run below finds nothing to do.
const COMPANION = `SELECT ${companionColumns("p")} FROM companions p`;
const NO_MEMORY = { kind: "nothing", reason: "This companion has no memory" } as const;

export function createScheduler(deps: SchedulerDeps) {
  const { db } = deps;
  /** Runs under way, by chat id, or by `tidy:` / `rebuild:` and a companion id. */
  const inFlight = new Map<string, Promise<RunOutcome>>();

  const load = (sql: string, id: string): Companion | null => {
    const row = db.prepare(sql).get(id) as Parameters<typeof companionOf>[0] | undefined;
    return row ? companionOf(row) : null;
  };
  const companionOfChat = (chatId: string) =>
    load(`${COMPANION} JOIN chats c ON c.companion_id = p.id WHERE c.id = ?`, chatId);
  const companionById = (id: string) => load(`${COMPANION} WHERE p.id = ?`, id);

  /** Starts `work` under `key`, or joins the one already running. */
  function once(key: string, work: () => Promise<RunOutcome>): Promise<RunOutcome> {
    const running = inFlight.get(key);
    if (running) return running;
    const run = work().finally(() => inFlight.delete(key));
    inFlight.set(key, run);
    return run;
  }

  const report = (what: string) => (outcome: RunOutcome) => {
    if (outcome.kind === "failed") console.error(`${what} failed: ${outcome.error}`);
  };
  const crashed = (what: string) => (err: unknown) => console.error(`${what} failed:`, err);

  /** Tidies a companion's memory now, or joins the tidy-up already running. */
  function tidy(companionId: string): Promise<RunOutcome> {
    const companion = companionById(companionId);
    if (!companion) return Promise.resolve({ kind: "nothing", reason: "No such companion" });
    if (!companion.memory) return Promise.resolve(NO_MEMORY);
    return once(`tidy:${companionId}`, () => cleanup(deps, companion));
  }

  /** Tidies a companion's memory in the background, if it is due. */
  function tidyIfDue(companionId: string): void {
    if (inFlight.has(`tidy:${companionId}`) || !cleanupDue(db, companionId, deps.cleanup)) return;
    tidy(companionId).then(report(`Tidying the memory of ${companionId}`), crashed(`Tidying ${companionId}`));
  }

  /** Folds a chat into memory now, or joins the run already doing it. */
  function now(chatId: string): Promise<RunOutcome> {
    const companion = companionOfChat(chatId);
    if (!companion) return Promise.resolve({ kind: "nothing", reason: "No such chat" });
    if (!companion.memory) return Promise.resolve(NO_MEMORY);
    return once(chatId, async () => {
      const outcome = await consolidate(deps, chatId, companion);
      if (outcome.kind === "done") tidyIfDue(companion.id);
      return outcome;
    });
  }

  /** Folds a chat into memory in the background. */
  function soon(chatId: string): void {
    now(chatId).then(report(`Updating memory from chat ${chatId}`), crashed(`Updating memory from ${chatId}`));
  }

  /** Starts on every other chat of the companion that memory hasn't caught up with. */
  function othersOf(companionId: string, exceptChatId: string): void {
    const ids = db
      .prepare(
        "SELECT c.id FROM chats c JOIN companions p ON p.id = c.companion_id WHERE c.companion_id = ? AND c.id != ? AND p.memory = 1",
      )
      .all(companionId, exceptChatId) as { id: string }[];
    for (const { id } of ids) if (hasPending(db, id)) soon(id);
  }

  /** Every chat quiet for `idleMinutes` with something memory doesn't have, unless its last try failed since. */
  function sweep(at = Date.now()): string[] {
    const cutoff = new Date(at - deps.idleMinutes * 60_000).toISOString();
    const rows = db
      .prepare(
        `SELECT c.id FROM chats c JOIN companions p ON p.id = c.companion_id
         WHERE c.last_activity_at < ? AND p.memory = 1
           AND NOT EXISTS (
             SELECT 1 FROM memory_runs r
             WHERE r.chat_id = c.id AND r.kind = 'consolidate' AND r.ok = 0 AND r.started_at > c.last_activity_at
               AND r.id = (SELECT max(id) FROM memory_runs WHERE chat_id = c.id AND kind = 'consolidate'))`,
      )
      .all(cutoff) as { id: string }[];
    const started: string[] = [];
    for (const { id } of rows) {
      if (inFlight.has(id) || !hasPending(db, id)) continue;
      soon(id);
      started.push(id);
    }
    // The weekly tidy-up, for companions whose memory changed but not often enough to trigger one.
    for (const { id } of db.prepare("SELECT id FROM companions WHERE memory = 1").all() as { id: string }[]) {
      tidyIfDue(id);
    }
    return started;
  }

  let timer: NodeJS.Timeout | null = null;
  return {
    now,
    soon,
    othersOf,
    sweep,
    tidy,

    /** Rebuilds a companion's memory from every chat, or joins the rebuild already running. */
    rebuild(companionId: string): Promise<RunOutcome> {
      const companion = companionById(companionId);
      if (!companion) return Promise.resolve({ kind: "nothing", reason: "No such companion" });
      if (!companion.memory) return Promise.resolve(NO_MEMORY);
      return once(`rebuild:${companionId}`, () => rebuild({ ...deps, partTokens: deps.partTokens }, companion));
    },

    /**
     * Turns memory on for a Grok companion without it, by building its memory from every chat
     * (rebuild.ts), or joins the run already doing it. Memory is never turned off again.
     */
    enableMemory(companionId: string): Promise<RunOutcome> {
      const companion = companionById(companionId);
      if (!companion) return Promise.resolve({ kind: "nothing", reason: "No such companion" });
      if (companion.memory) return Promise.resolve({ kind: "nothing", reason: "This companion already has memory" });
      if (companion.provider !== "xai") {
        return Promise.resolve({ kind: "nothing", reason: "Only a Grok companion can have memory turned on later" });
      }
      return once(`rebuild:${companionId}`, () =>
        rebuild({ ...deps, partTokens: deps.partTokens }, companion, { enable: true }),
      );
    },

    /** Whether a chat is being folded into memory right now. */
    running: (chatId: string) => inFlight.has(chatId),
    /** Whether a companion's memory is being rebuilt right now. */
    rebuilding: (companionId: string) => inFlight.has(`rebuild:${companionId}`),

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
