// Asking for a reply: the greeting, an answer to what you just said, or another version of one.
//
// Every reply is written against the selected path up to its parent and stored only once it is
// finished, together with whatever has to be stored with it (your message, the new end of the
// path), in one transaction. A reply that fails leaves nothing behind and can simply be asked for
// again; a reply whose page was closed mid-stream is still saved — the server finishes it.
import type { DatabaseSync } from "node:sqlite";
import type { Companion, Message, StreamEvent } from "../../shared/protocol.ts";
import { promptOf, rejectionNote } from "../../shared/prompts.ts";
import type { Writer } from "../claude.ts";
import { transaction } from "../db.ts";
import { invalid } from "../errors.ts";
import { asParams, buildSystem, outgoing } from "../prompt.ts";
import type { Tree } from "./tree.ts";

export interface TurnContext {
  db: DatabaseSync;
  tree: Tree;
  companion: Companion;
  write: Writer;
  onEvent: (event: StreamEvent) => void;
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

/** Writes a reply to `path` and returns what to store, reporting it as it is written. */
async function reply(context: TurnContext, path: Message[], instruction: string | null) {
  const { companion, write, onEvent } = context;
  const system = buildSystem(companion);
  const messages = asParams(outgoing(path, { instruction }));
  return write(system, messages, companion.settings, onEvent);
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
