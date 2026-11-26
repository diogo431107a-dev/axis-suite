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
import { peekSnapshot, refreshSnapshot, snapshotFor } from "../memory/inject.ts";
import type { Memory } from "../memory/store.ts";
import { asParams, buildSystem, outgoing, type Outgoing, type SystemBlock } from "../prompt.ts";
import type { Tree } from "./tree.ts";

export interface WindowSize {
  /** About how many tokens of the chat are sent. */
  tokens: number;
  /** How many exchanges slide out at once. */
  chunk: number;
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
  /** Told when the oldest turns slide out of the window, so they can be folded into memory. */
  onSlide?: () => void;
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
 * window holds. With `keep`, a slide of the window is kept, memory is looked at afresh with it,
 * and `onSlide` is told; without, nothing is changed (for Inspect and the token count).
 */
export function prepare(
  context: Pick<TurnContext, "db" | "chatId" | "companion" | "memory" | "window" | "onSlide">,
  path: Message[],
  next: { instruction: string | null } | undefined,
  keep: boolean,
): Prepared {
  const { db, chatId, companion, memory, window } = context;
  const { window_start: stored } = db.prepare("SELECT window_start FROM chats WHERE id = ?").get(chatId) as {
    window_start: number | null;
  };
  const at = windowFor(path, stored, window.tokens, window.chunk);
  let snapshot: string;
  if (!keep) {
    snapshot = peekSnapshot(db, memory, chatId, companion);
  } else {
    if (at.slid) {
      db.prepare("UPDATE chats SET window_start = ? WHERE id = ?").run(at.startId, chatId);
      refreshSnapshot(db, memory, chatId, companion);
      if (at.startId !== null) context.onSlide?.();
    }
    snapshot = snapshotFor(db, memory, chatId, companion);
  }
  return { system: buildSystem(companion, snapshot), messages: outgoing(path.slice(at.from), next) };
}

/** Writes a reply to `path` and returns what to store, reporting it as it is written. */
async function reply(context: TurnContext, path: Message[], instruction: string | null) {
  const { companion, write, onEvent, chatId } = context;
  const { system, messages } = prepare(context, path, { instruction }, true);
  return write(system, asParams(messages), companion.settings, onEvent, { cacheKey: chatId });
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
