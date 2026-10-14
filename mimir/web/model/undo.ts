// Undo and redo for one map. A step is what one command did: the ops it applied and the ops that
// undo them (computed by the store while applying), with what was selected before and after.
import type { Op } from "../../shared/protocol.ts";

/** What was selected, to select it again on undo and redo. */
export type Focus = { kind: "node"; id: string } | { kind: "arrow"; id: string } | null;

export interface Step {
  ops: Op[];
  inverse: Op[];
  before: Focus;
  after: Focus;
}

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
    this.#undo.push(step);
    if (this.#undo.length > MAX_STEPS) this.#undo.shift();
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
