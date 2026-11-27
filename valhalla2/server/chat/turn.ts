// Asking for a reply: the greeting, an answer to what you just said, or another version of one.
//
// Every reply is written against the selected path up to its parent and stored only once it is
// finished, together with whatever has to be stored with it (your message, the new end of the
// path), in one transaction. A reply that fails leaves nothing behind and can simply be asked for
// again; a reply whose page was closed mid-stream is still saved — the server finishes it.
import type { DatabaseSync } from "node:sqlite";
import type { Companion, Message, StreamEvent } from "../../shared/protocol.ts";
import { promptOf, rejectionNote } from "../../shared/prompts.ts";
import type { Writer } from "../claude/reply.ts";
import { transaction } from "../db.ts";
import { invalid } from "../errors.ts";
import { windowFor } from "../memory/history.ts";
import { peekSnapshot, refreshSnapshot, renderPins, snapshotFor } from "../memory/inject.ts";
import type { Memory } from "../memory/store.ts";
import { pinsOf } from "../pins.ts";
import { asParams, buildSystem, outgoing, type Outgoing, type SystemBlock } from "../prompt.ts";
import type { Tree } from "./tree.ts";

export interface WindowSize {
  /** About how many tokens of the chat are sent. */
  tokens: number;
  /** How many exchanges slide out at once. */
  chunk: number;
  /** How far down a slide goes, when that is lower than `tokens` (see windowFor). */
  slideTo?: number;
}

export interface TurnContext {
  db: DatabaseSync;
  tree: Tree;
  chatId: string;
  companion: Companion;
  memory: Memory;
  window: WindowSize;
  write: Writer;
  onEvent: (event: StreamEvent) => void;
  /**
   * Told when the oldest turns slide out of the window, to fold them into memory; settles once
   * that run has finished, however it went.
   */
  onSlide?: () => Promise<unknown>;
}

/**
 * How long a reply waits for the turns that slid out to be folded into memory. Past it the reply
 * goes on without the slide (see prepare), and the run carries on in the background.
 */
export const SLIDE_WAIT_MS = 3 * 60_000;

/** Whether `run` settled within SLIDE_WAIT_MS. A run that crashed counts as settled. */
async function settledInTime(run: Promise<unknown>): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), SLIDE_WAIT_MS);
  });
  const done = run.then(
    () => true,
    (err: unknown) => {
      console.error("Updating memory after a slide failed:", err);
      return true;
    },
  );
  try {
    return await Promise.race([done, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The hidden instruction a new reply under `parentId` is written with: the greeting instruction
 * for a greeting, and the reason you gave for rejecting the versions before it, if you gave one.
 */
export function instructionFor(tree: Tree, companion: Companion, parentId: number | null): string | null {
  const parts: string[] = [];
  if (parentId === null) parts.push(promptOf(companion, "greeting"));
  const reason = tree.feedbackFor(parentId)?.reason;
  if (reason) parts.push(rejectionNote(companion, reason));
  return parts.length > 0 ? parts.join("\n\n") : null;
}

export interface Prepared {
  system: SystemBlock[];
  messages: Outgoing[];
}

/**
 * The request for `path`: the system prompt with the chat's memory, and the part of the path the
 * window holds. With `keep`, a slide of the window is kept and memory is looked at afresh with it;
 * without, nothing is changed and nothing waits (for Inspect and the token count).
 *
 * For a companion with memory, the turns that slide out are folded into memory first: `onSlide`
 * runs, the reply waits for it (saying `remembering`), and only then is the new snapshot taken, so
 * it holds them. A run that fails still lets the slide go ahead, on memory as it stands. A run still
 * going after SLIDE_WAIT_MS doesn't: this reply keeps the window and snapshot it had, so the turns
 * are still sent, and the next one tries again (joining the run if it is still going).
 *
 * A companion without memory sends its profile and its pins, and as much of the path as its far
 * larger window holds (chatWindow in write.ts). There is no memory to slide turns out into, so what
 * slides out is simply no longer sent, and `onSlide` is never told.
 */
export async function prepare(
  context: Pick<TurnContext, "db" | "chatId" | "companion" | "memory" | "window" | "onSlide"> &
    Partial<Pick<TurnContext, "onEvent">>,
  path: Message[],
  next: { instruction: string | null } | undefined,
  keep: boolean,
): Promise<Prepared> {
  const { db, chatId, companion, memory, window } = context;
  const { window_start: stored } = db.prepare("SELECT window_start FROM chats WHERE id = ?").get(chatId) as {
    window_start: number | null;
  };
  const keepStart = (startId: number | null) =>
    db.prepare("UPDATE chats SET window_start = ? WHERE id = ?").run(startId, chatId);
  if (!companion.memory) {
    const pins = pinsOf(db, companion.id);
    const system = buildSystem(companion, pins.length > 0 ? renderPins(companion, pins) : null);
    // The profile and the pins always go whole; the chat has what is left of the window.
    const fixed = system.reduce((sum, block) => sum + Math.ceil(block.text.length / 4), 0);
    const room = (tokens: number) => Math.max(0, tokens - fixed);
    const at = windowFor(path, stored, room(window.tokens), window.chunk, room(window.slideTo ?? window.tokens));
    if (keep && at.slid) keepStart(at.startId);
    return { system, messages: outgoing(path.slice(at.from), next) };
  }
  let at = windowFor(path, stored, window.tokens, window.chunk);
  let snapshot: string;
  if (!keep) {
    snapshot = peekSnapshot(db, memory, chatId, companion);
  } else {
    if (at.slid) {
      let folded = true;
      if (at.startId !== null && context.onSlide) {
        context.onEvent?.({ type: "remembering", about: "this" });
        folded = await settledInTime(context.onSlide());
      }
      if (folded) {
        keepStart(at.startId);
        refreshSnapshot(db, memory, chatId, companion);
      } else {
        // Where the window started before: nothing is measured against a budget there.
        at = windowFor(path, stored, Infinity, window.chunk);
      }
    }
    snapshot = snapshotFor(db, memory, chatId, companion);
  }
  return { system: buildSystem(companion, snapshot), messages: outgoing(path.slice(at.from), next) };
}

/** Writes a reply to `path` and returns what to store, reporting it as it is written. */
async function reply(context: TurnContext, path: Message[], instruction: string | null) {
  const { companion, write, onEvent, chatId } = context;
  const { system, messages } = await prepare(context, path, { instruction }, true);
  return write(system, asParams(messages), companion.settings, onEvent, {
    cacheKey: chatId,
    provider: companion.provider,
  });
}

/** Says something at the end of the selected path, and gets the companion's answer. */
export async function send(context: TurnContext, text: string): Promise<Message> {
  const { db, tree } = context;
  const parentId = tree.activeLeaf();
  const at = new Date().toISOString();
  const mine: Message = {
    id: 0,
    parentId,
    role: "user",
    content: [{ type: "text", text }],
    instruction: null,
    isGreeting: false,
    at,
    editedAt: null,
    reply: null,
  };
  const answer = await reply(context, [...tree.pathTo(parentId), mine], null);
  return transaction(db, () => {
    const said = tree.add({ parentId, role: "user", content: mine.content, at });
    const answered = tree.add({ parentId: said.id, role: "assistant", content: answer.content, reply: answer.details });
    tree.setLeaf(answered.id);
    return answered;
  });
}

/**
 * Writes a new reply under `parentId` — one of your messages, or null for the greeting — and
 * selects it. Another version of a reply (a swipe) is this, under the same parent.
 */
export async function generate(context: TurnContext, parentId: number | null): Promise<Message> {
  const { db, tree, companion } = context;
  if (parentId !== null && tree.get(parentId).role !== "user") invalid("A reply can only answer one of your messages");
  const instruction = instructionFor(tree, companion, parentId);
  const answer = await reply(context, tree.pathTo(parentId), instruction);
  return transaction(db, () => {
    const answered = tree.add({
      parentId,
      role: "assistant",
      content: answer.content,
      instruction,
      isGreeting: parentId === null,
      reply: answer.details,
    });
    tree.setLeaf(answered.id);
    return answered;
  });
}
