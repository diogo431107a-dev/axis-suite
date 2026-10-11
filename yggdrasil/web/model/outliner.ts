// The app's model in one place: the tree, the sync queue, undo history and UI state. Every edit
// goes through commit(), which applies it, queues it for the server and records it for undo.
import type { Op } from "../../shared/protocol.ts";
import type { TextSource } from "../io/plaintext.ts";
import type { Ctx, Result } from "./commands.ts";
import { Store } from "./store.ts";
import { Sync, type SyncEvents } from "./sync.ts";
import { Ui, isShown, type Field } from "./ui.ts";
import { History, type Focus, type Step } from "./undo.ts";

export interface CommitOptions {
  /** Steps with the same key less than a second apart are undone together (typing). */
  mergeKey?: string;
  /** The focus before the change, when the UI state doesn't know it (the editor's caret). */
  before?: Focus;
  /** The focus after the change, when the result has no caret. */
  after?: Focus;
}

export class Outliner {
  readonly store = new Store();
  readonly history = new History();
  readonly ui = new Ui();
  readonly sync: Sync;
  readonly username: string;

  constructor(username: string, events: Pick<SyncEvents, "notice">) {
    this.username = username;
    this.sync = new Sync(this.store, username, {
      notice: events.notice,
      // Steps recorded before a reload may refer to nodes that are gone.
      reloaded: () => this.history.clear(),
    });
  }

  /** The outline as commands see it: what is shown, inside the zoomed-in bullet. */
  ctx(): Ctx {
    const { store } = this;
    const view = this.ui.view;
    return {
      get: (id) => store.get(id),
      children: (parentId) => store.children(parentId),
      shown: (parentId) => store.children(parentId).filter((id) => isShown(store.get(id), view)),
      expanded: (id) => id === view.zoom || view.filter !== null || store.get(id)?.collapsed === false,
      root: view.zoom,
      newId: () => crypto.randomUUID(),
      now: () => new Date().toISOString(),
    };
  }

  /** The tree for copying and exporting: every child that isn't deleted, collapsed or not. */
  textSource(): TextSource {
    return {
      get: (id) => this.store.get(id),
      children: (id) => this.store.children(id).filter((k) => this.store.get(k)?.deletedAt === null),
    };
  }

  /** Runs a command against the current outline and commits what it returns. */
  run(command: (ctx: Ctx) => Result | null, options?: CommitOptions): boolean {
    return this.commit(command(this.ctx()), options);
  }

  /** Applies a command's result as one undo step. Returns false if it changed nothing. */
  commit(result: Result | null, options: CommitOptions = {}): boolean {
    if (!result || result.ops.length === 0) return false;
    const before = options.before ?? this.focus();
    const inverse = this.store.applyAll(result.ops);
    if (inverse.length === 0) return false;
    this.sync.push(result.ops);
    if (result.caret) this.ui.setCaret(result.caret.id, result.caret.offset);
    const after = result.caret ? this.focus() : (options.after ?? this.focus());
    this.history.record({ ops: result.ops, inverse, before, after, mergeKey: options.mergeKey, at: Date.now() });
    return true;
  }

  /** A keystroke in an editor: the field's new text, as part of the current typing step. */
  type(id: string, field: Field, value: string, before: Focus, after: Focus): void {
    const op: Op = field === "content" ? { op: "update", id, content: value } : { op: "update", id, note: value };
    this.commit({ ops: [op] }, { mergeKey: `type:${field}:${id}`, before, after });
  }

  undo(): void {
    const step = this.history.popUndo();
    if (!step) return;
    const redo = this.store.applyAll(step.inverse);
    this.sync.push(step.inverse);
    this.history.pushRedo({ ...step, ops: redo, inverse: step.inverse, mergeKey: undefined });
    this.restore(step.before);
  }

  redo(): void {
    const step = this.history.popRedo();
    if (!step) return;
    const undo = this.store.applyAll(step.ops);
    this.sync.push(step.ops);
    const again: Step = { ...step, inverse: undo, at: Date.now() };
    this.history.pushUndo(again);
    this.restore(step.after);
  }

  /** The caret or selection as it is now, for undo. */
  focus(): Focus {
    const { caret, selection } = this.ui;
    if (caret) return { kind: "caret", id: caret.id, field: caret.field, start: caret.start, end: caret.end };
    if (selection) return { kind: "blocks", ids: selection.ids };
    return null;
  }

  restore(focus: Focus): void {
    if (focus?.kind === "caret" && this.store.get(focus.id)?.deletedAt === null) {
      this.ui.setCaret(focus.id, focus.start, focus.field, focus.end);
    } else if (focus?.kind === "blocks") {
      const ids = focus.ids.filter((id) => this.store.get(id)?.deletedAt === null);
      const first = ids[0] && this.store.get(ids[0]);
      if (first) this.ui.select({ parentId: first.parentId, anchor: ids[0]!, head: ids.at(-1)! }, ids);
    }
  }
}
