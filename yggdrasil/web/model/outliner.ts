// The app's model in one place: the tree, the sync queue, undo history and UI state. Every edit
// goes through commit(), which applies it, queues it for the server and records it for undo.
import type { Op, Role } from "../../shared/protocol.ts";
import { Uploads } from "../files/uploads.ts";
import type { TextSource } from "../io/plaintext.ts";
import { localDate } from "../text/dates.ts";
import { parseQuery, type Term } from "../search/query.ts";
import { highlightPattern, runSearch, sameSet } from "../search/run.ts";
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

export const READ_ONLY = "This bullet is shared with you to read only.";
const OWNER_ONLY = "Only its owner can move or delete this bullet.";

/** The fields a bullet shared with someone keeps for them alone; anyone may change those. */
const OWN_VIEW = new Set(["op", "id", "collapsed", "starred"]);

/**
 * Why ops can't be made on the bullets shared with the user, or null if they can: the same rules
 * as the server's. `roleOf` is the store's; `isSharedTop` tells the tops of shared bullets.
 */
export function refusal(
  ops: readonly Op[],
  roleOf: (id: string | null, parents: ReadonlyMap<string, string | null>) => Role,
  isSharedTop: (id: string) => boolean,
): string | null {
  const parents = new Map<string, string | null>();
  for (const op of ops) if (op.op === "create") parents.set(op.id, op.parentId);
  const role = (id: string | null) => roleOf(id, parents);
  for (const op of ops) {
    switch (op.op) {
      case "create":
        if (role(op.parentId) === "viewer") return READ_ONLY;
        break;
      case "update":
        if (role(op.id) === "viewer" && Object.keys(op).some((k) => !OWN_VIEW.has(k))) return READ_ONLY;
        break;
      case "move":
        if (role(op.id) === "viewer" || role(op.parentId) === "viewer") return READ_ONLY;
        if (isSharedTop(op.id)) return OWNER_ONLY;
        break;
      case "delete":
      case "restore":
        if (role(op.id) === "viewer") return READ_ONLY;
        if (isSharedTop(op.id)) return OWNER_ONLY;
        break;
    }
  }
  return null;
}

export class Outliner {
  readonly store = new Store();
  readonly history = new History();
  readonly ui = new Ui();
  readonly uploads = new Uploads();
  readonly sync: Sync;
  readonly username: string;
  /** Tells the user something went wrong (a toast). */
  readonly notice: (message: string) => void;

  #query = "";
  #terms: Term[] = [];
  #queryListeners = new Set<() => void>();
  #searchScheduled = false;
  /** What the shown search results were computed for. */
  #searchedFor = { zoom: null as string | null, showCompleted: true };

  constructor(username: string, events: Pick<SyncEvents, "notice">) {
    this.username = username;
    this.notice = events.notice;
    this.sync = new Sync(this.store, username, {
      notice: events.notice,
      // Steps recorded before a reload may refer to nodes that are gone.
      reloaded: () => this.history.clear(),
    });
    // An open search follows the tree as it changes, and the zoom and view settings.
    this.store.subscribe(() => this.#scheduleSearch());
    this.ui.subscribe(() => {
      const { zoom, showCompleted } = this.ui.view;
      if (zoom !== this.#searchedFor.zoom || showCompleted !== this.#searchedFor.showCompleted) this.#scheduleSearch();
    });
  }

  // ---- Search -------------------------------------------------------------------------------

  get query(): string {
    return this.#query;
  }

  /** Opens, changes or (with "") closes the search within the zoomed-in bullet. */
  setQuery(query: string): void {
    if (query === this.#query) return;
    this.#query = query;
    this.#terms = parseQuery(query);
    this.#search();
    for (const l of this.#queryListeners) l();
  }

  subscribeQuery(listener: () => void): () => void {
    this.#queryListeners.add(listener);
    return () => this.#queryListeners.delete(listener);
  }

  // Once per burst of changes, after the change that caused it (and any caret move) is done.
  #scheduleSearch(): void {
    if (this.#terms.length === 0 || this.#searchScheduled) return;
    this.#searchScheduled = true;
    queueMicrotask(() => {
      this.#searchScheduled = false;
      this.#search();
    });
  }

  #search(): void {
    const view = this.ui.view;
    this.#searchedFor = { zoom: view.zoom, showCompleted: view.showCompleted };
    if (this.#terms.length === 0) {
      if (view.filter) this.ui.setView({ filter: null, matches: null, highlight: null });
      return;
    }
    const keep = this.ui.caret?.id ?? null;
    const result = runSearch(this.store, view.zoom, this.#terms, view.showCompleted, localDate(), keep);
    const highlight = highlightPattern(this.#terms);
    if (
      sameSet(result.filter, view.filter) &&
      sameSet(result.matches, view.matches) &&
      String(highlight) === String(view.highlight)
    ) {
      return;
    }
    this.ui.setView({ filter: result.filter, matches: result.matches, highlight });
  }

  // ---- Editing ------------------------------------------------------------------------------

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

  /** Whether the user may change the text of bullet id (not only if it is shared with them to read). */
  canEdit(id: string): boolean {
    return this.store.roleOf(id) !== "viewer";
  }

  /**
   * Applies a command's result as one undo step. Returns false if it changed nothing, or if it
   * would change a bullet shared with the user in a way they may not (they are told why).
   */
  commit(result: Result | null, options: CommitOptions = {}): boolean {
    if (!result || result.ops.length === 0) return false;
    const refused = refusal(
      result.ops,
      (id, parents) => this.store.roleOf(id, parents),
      (id) => this.store.get(id)?.parentId === null && this.store.sharedWithMe(id) !== undefined,
    );
    if (refused) {
      this.notice(refused);
      return false;
    }
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
