// What the page shows apart from the tree itself: which bullet is being edited (and where its
// caret should go), the block selection, the zoomed-in bullet and the view settings. Bullets
// subscribe to their own id, so moving the caret re-renders two bullets, not all of them.
import type { Node } from "../../shared/protocol.ts";

type Listener = () => void;

export type Field = "content" | "note";

/** The bullet being edited. start/end is where the caret should be when the editor (re)mounts. */
export interface Caret {
  id: string;
  field: Field;
  start: number;
  end: number;
  /** Bumped whenever the caret is placed from outside the editor, so the editor applies it. */
  seq: number;
}

/** A block of siblings selected as whole bullets (Esc, Shift+Up/Down). */
export interface Selection {
  parentId: string | null;
  anchor: string;
  head: string;
  /** anchor..head in the order shown. */
  ids: string[];
}

/** View settings every bullet depends on. A new object whenever one changes. */
export interface View {
  zoom: string | null;
  showCompleted: boolean;
  /** While a search is open: the bullets to show (matches and their ancestors). */
  filter: ReadonlySet<string> | null;
  /** The bullets that match the search, for highlighting. */
  matches: ReadonlySet<string> | null;
}

const SHOW_COMPLETED_KEY = "yggdrasil.showCompleted";

function readShowCompleted(): boolean {
  try {
    return localStorage.getItem(SHOW_COMPLETED_KEY) !== "false";
  } catch {
    return true;
  }
}

/** Whether a node is shown under its parent in this view. */
export function isShown(node: Node | undefined, view: View): boolean {
  if (!node || node.deletedAt !== null) return false;
  if (view.filter) return view.filter.has(node.id);
  return view.showCompleted || node.completedAt === null;
}

export class Ui {
  #caret: Caret | null = null;
  #seq = 0;
  #selection: Selection | null = null;
  #selected = new Set<string>();
  #view: View = { zoom: null, showCompleted: readShowCompleted(), filter: null, matches: null };
  #idListeners = new Map<string, Set<Listener>>();
  #listeners = new Set<Listener>();

  get caret(): Caret | null {
    return this.#caret;
  }

  get selection(): Selection | null {
    return this.#selection;
  }

  get view(): View {
    return this.#view;
  }

  isSelected(id: string): boolean {
    return this.#selected.has(id);
  }

  /** Edits bullet id with the caret at start..end (end defaults to start). Ends any block selection. */
  setCaret(id: string, start: number, field: Field = "content", end = start): void {
    const prev = this.#caret;
    this.#caret = { id, field, start, end, seq: ++this.#seq };
    this.#clearSelection();
    if (prev && prev.id !== id) this.#emitId(prev.id);
    this.#emitId(id);
    this.#emit();
  }

  /**
   * Records where the caret is, without telling the editor to move it: used before a change
   * that remounts the bullet (indent, move), so it comes back with the caret in the same place.
   */
  rememberCaret(id: string, field: Field, start: number, end: number): void {
    if (this.#caret?.id === id) this.#caret = { ...this.#caret, field, start, end };
  }

  /** Stops editing (if bullet id is the one being edited, when given). */
  clearCaret(id?: string): void {
    if (!this.#caret || (id !== undefined && this.#caret.id !== id)) return;
    const prev = this.#caret.id;
    this.#caret = null;
    this.#emitId(prev);
    this.#emit();
  }

  select(selection: Omit<Selection, "ids">, ids: string[]): void {
    const prevCaret = this.#caret;
    this.#caret = null;
    if (prevCaret) this.#emitId(prevCaret.id);
    const old = this.#selected;
    this.#selection = { ...selection, ids };
    this.#selected = new Set(ids);
    for (const id of old) if (!this.#selected.has(id)) this.#emitId(id);
    for (const id of ids) if (!old.has(id)) this.#emitId(id);
    this.#emit();
  }

  clearSelection(): void {
    if (this.#clearSelection()) this.#emit();
  }

  setView(patch: Partial<View>): void {
    this.#view = { ...this.#view, ...patch };
    if (patch.showCompleted !== undefined) {
      try {
        localStorage.setItem(SHOW_COMPLETED_KEY, String(patch.showCompleted));
      } catch {
        // a convenience only
      }
    }
    this.#emit();
  }

  /** Called when the caret or selection of bullet id changes. */
  subscribeId(id: string, listener: Listener): () => void {
    let set = this.#idListeners.get(id);
    if (!set) this.#idListeners.set(id, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0 && this.#idListeners.get(id) === set) this.#idListeners.delete(id);
    };
  }

  /** Called on every change. */
  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #clearSelection(): boolean {
    if (!this.#selection) return false;
    const old = this.#selected;
    this.#selection = null;
    this.#selected = new Set();
    for (const id of old) this.#emitId(id);
    return true;
  }

  #emitId(id: string): void {
    for (const l of this.#idListeners.get(id) ?? []) l();
  }

  #emit(): void {
    for (const l of this.#listeners) l();
  }
}
