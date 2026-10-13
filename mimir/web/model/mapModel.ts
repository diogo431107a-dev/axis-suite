// One open map: its store, its undo history, and the one way to change it, commit(), which
// applies a command's ops, queues them for the server and records them for undo.
import type { TextSource } from "../io/plaintext.ts";
import type { Ctx, Result } from "./commands.ts";
import { MapStore } from "./store.ts";
import type { Sync } from "./sync.ts";
import { History, type Focus, type Step } from "./undo.ts";

export class MapModel {
  readonly store = new MapStore();
  readonly history = new History();
  readonly mapId: string;
  readonly #sync: Sync;

  constructor(mapId: string, sync: Sync) {
    this.mapId = mapId;
    this.#sync = sync;
  }

  ctx(): Ctx {
    const { store } = this;
    return {
      rootId: store.rootId,
      get: (id) => store.get(id),
      children: (parentId) => store.children(parentId),
      newId: () => crypto.randomUUID(),
    };
  }

  /** The map for copying and exporting: every live child, folded or not. */
  textSource(): TextSource {
    return {
      text: (id) => this.store.get(id)?.text ?? "",
      children: (id) => this.store.liveChildren(id),
    };
  }

  /**
   * Applies a command's result as one undo step. Returns false if it changed nothing. `before` is
   * what was selected; `after` what to select on redo (the result's own choice by default).
   */
  commit(result: Result | null, before: Focus, after?: Focus): boolean {
    if (!result || result.ops.length === 0) return false;
    const inverse = this.store.applyAll(result.ops);
    if (inverse.length === 0) return false;
    this.#sync.push(this.mapId, result.ops);
    const next = after ?? (result.select ? { kind: "node" as const, id: result.select } : before);
    this.history.record({ ops: result.ops, inverse, before, after: next });
    return true;
  }

  /** Undoes the last step; returns what to select then, or undefined if there was nothing to undo. */
  undo(): Focus | undefined {
    const step = this.history.popUndo();
    if (!step) return undefined;
    const redo = this.store.applyAll(step.inverse);
    this.#sync.push(this.mapId, step.inverse);
    this.history.pushRedo({ ...step, ops: redo, inverse: step.inverse });
    return step.before;
  }

  redo(): Focus | undefined {
    const step = this.history.popRedo();
    if (!step) return undefined;
    const undo = this.store.applyAll(step.ops);
    this.#sync.push(this.mapId, step.ops);
    const again: Step = { ...step, inverse: undo };
    this.history.pushUndo(again);
    return step.after;
  }
}
