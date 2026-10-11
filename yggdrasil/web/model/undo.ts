// Undo and redo for the whole app. A step is a transaction: the ops it applied and the ops that
// undo them (computed from the store before applying). Typing into one bullet is a single step
// until a pause of more than a second or a move to another bullet.
import { FIELD_NAMES, type Op } from "../../shared/protocol.ts";

/** Where the caret or block selection was, to restore it on undo and redo. */
export type Focus =
  | { kind: "caret"; id: string; start: number; end: number; field: "content" | "note" }
  | { kind: "blocks"; ids: string[] }
  | null;

export interface Step {
  ops: Op[];
  inverse: Op[];
  before: Focus;
  after: Focus;
  /** Steps with the same key, close together in time, become one. */
  mergeKey?: string;
  at: number;
}

/** Typing steps further apart than this are kept separate. */
const MERGE_MS = 1000;
const MAX_STEPS = 500;

export class History {
  #undo: Step[] = [];
  #redo: Step[] = [];

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  /** Records a step just applied. A new step makes the redo stack meaningless. */
  record(step: Step): void {
    this.#redo = [];
    const last = this.#undo.at(-1);
    if (last && step.mergeKey && last.mergeKey === step.mergeKey && step.at - last.at <= MERGE_MS) {
      last.ops = mergeOps(last.ops, step.ops);
      // The older inverse holds the values from before both steps, so it wins.
      last.inverse = mergeInverse(step.inverse, last.inverse);
      last.after = step.after;
      last.at = step.at;
      return;
    }
    this.#undo.push(step);
    if (this.#undo.length > MAX_STEPS) this.#undo.shift();
  }

  /** Ends the current typing step, so the next keystroke starts a new one. */
  seal(): void {
    const last = this.#undo.at(-1);
    if (last) last.mergeKey = undefined;
  }

  /** The step to undo, moved to the redo stack by the caller with pushRedo. */
  popUndo(): Step | undefined {
    return this.#undo.pop();
  }

  popRedo(): Step | undefined {
    return this.#redo.pop();
  }

  /** After undoing: the step that redoes it. */
  pushRedo(step: Step): void {
    this.#redo.push(step);
  }

  /** After redoing: the step that undoes it again, keeping the redo stack. */
  pushUndo(step: Step): void {
    this.#undo.push(step);
  }

  clear(): void {
    this.#undo = [];
    this.#redo = [];
  }
}

type Update = Extract<Op, { op: "update" }>;
const isUpdate = (op: Op | undefined): op is Update => op?.op === "update";

/** later's ops after earlier's; an update of the same node as the last one is folded into it. */
function mergeOps(earlier: Op[], later: Op[]): Op[] {
  const last = earlier.at(-1);
  if (later.length === 1 && isUpdate(later[0]) && isUpdate(last) && last.id === later[0].id) {
    return [...earlier.slice(0, -1), { ...last, ...later[0] }];
  }
  return [...earlier, ...later];
}

/** The inverse of (earlier then later): later's inverse first; same-node updates folded, older values winning. */
function mergeInverse(laterInverse: Op[], earlierInverse: Op[]): Op[] {
  const first = earlierInverse[0];
  if (laterInverse.length === 1 && isUpdate(laterInverse[0]) && isUpdate(first) && first.id === laterInverse[0].id) {
    const folded: Update = { ...laterInverse[0] };
    for (const f of FIELD_NAMES) if (first[f] !== undefined) (folded as Record<string, unknown>)[f] = first[f];
    return [folded, ...earlierInverse.slice(1)];
  }
  return [...laterInverse, ...earlierInverse];
}
