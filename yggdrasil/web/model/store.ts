// The tree in the browser: every node by id, the children of each node in order, and
// subscriptions so a component re-renders only when its own node or child list changes.
import {
  FIELD_NAMES,
  compareSiblings,
  type FieldName,
  type Node,
  type NodeFields,
  type Op,
} from "../../shared/protocol.ts";

type Listener = () => void;

/** What a server row may not overwrite because a local op on it hasn't landed yet. */
export type Guarded = FieldName | "place" | "deletedAt";

const ROOT = "";
const keyOf = (parentId: string | null) => parentId ?? ROOT;
const NO_CHILDREN: readonly string[] = Object.freeze([]);

export function newNode(id: string, parentId: string | null, rank: string): Node {
  return {
    id,
    parentId,
    rank,
    content: "",
    note: "",
    completedAt: null,
    collapsed: false,
    starred: false,
    deletedAt: null,
  };
}

export class Store {
  #nodes = new Map<string, Node>();
  /** Child ids per parent (ROOT for top level), sorted, deleted ones included. */
  #kids = new Map<string, readonly string[]>();
  #nodeListeners = new Map<string, Set<Listener>>();
  #kidsListeners = new Map<string, Set<Listener>>();
  #listeners = new Set<Listener>();
  #version = 0;
  // Notifications wait until the outermost batch() ends.
  #depth = 0;
  #changedNodes = new Set<string>();
  #changedKids = new Set<string>();
  #changedAll = false;

  get(id: string): Node | undefined {
    return this.#nodes.get(id);
  }

  /**
   * The children of a node (null: the top level), in order, deleted ones included. The same
   * array comes back until the list changes, or a child is deleted, restored, completed or
   * uncompleted, so it can be a useSyncExternalStore snapshot.
   */
  children(parentId: string | null): readonly string[] {
    return this.#kids.get(keyOf(parentId)) ?? NO_CHILDREN;
  }

  /** Counts every change, for views that depend on the whole tree (search, sidebar). */
  get version(): number {
    return this.#version;
  }

  get size(): number {
    return this.#nodes.size;
  }

  all(): IterableIterator<Node> {
    return this.#nodes.values();
  }

  /** Replaces the whole tree. */
  load(nodes: Node[]): void {
    this.#nodes = new Map(nodes.map((n) => [n.id, n]));
    const groups = new Map<string, Node[]>();
    for (const n of nodes) {
      const key = keyOf(n.parentId);
      const group = groups.get(key);
      if (group) group.push(n);
      else groups.set(key, [n]);
    }
    this.#kids = new Map();
    for (const [key, group] of groups)
      this.#kids.set(
        key,
        group.sort(compareSiblings).map((n) => n.id),
      );
    this.batch(() => {
      this.#changedAll = true;
    });
  }

  /** Runs fn, then tells subscribers once about everything it changed. */
  batch<T>(fn: () => T): T {
    this.#depth++;
    try {
      return fn();
    } finally {
      if (--this.#depth === 0) this.#notify();
    }
  }

  /**
   * Applies a local op the way the server will. Returns the ops that undo it, or none if it
   * changed nothing.
   */
  apply(op: Op, now: string): Op[] {
    const node = this.#nodes.get(op.id);
    switch (op.op) {
      case "create": {
        if (node) return []; // as on the server: already there, left alone
        const { op: _op, id, parentId, rank, ...fields } = op;
        this.batch(() => this.#put({ ...newNode(id, parentId, rank), ...fields }));
        return [{ op: "delete", id }];
      }
      case "update": {
        if (!node) return [];
        const before: Partial<NodeFields> = {};
        const next: Record<string, unknown> = { ...node };
        let changed = false;
        for (const f of FIELD_NAMES) {
          if (op[f] !== undefined && op[f] !== node[f]) {
            (before as Record<string, unknown>)[f] = node[f];
            next[f] = op[f];
            changed = true;
          }
        }
        if (!changed) return [];
        this.batch(() => this.#put(next as unknown as Node));
        return [{ op: "update", id: op.id, ...before }];
      }
      case "move":
        if (!node || (node.parentId === op.parentId && node.rank === op.rank)) return [];
        this.batch(() => this.#put({ ...node, parentId: op.parentId, rank: op.rank }));
        return [{ op: "move", id: op.id, parentId: node.parentId, rank: node.rank }];
      case "delete":
        if (!node || node.deletedAt !== null) return [];
        this.batch(() => this.#put({ ...node, deletedAt: now }));
        return [{ op: "restore", id: op.id }];
      case "restore":
        if (!node || node.deletedAt === null) return [];
        this.batch(() => this.#put({ ...node, deletedAt: null }));
        return [{ op: "delete", id: op.id }];
    }
  }

  /** Applies ops in order. Returns the ops that undo all of them, in the order to apply them. */
  applyAll(ops: readonly Op[], now = new Date().toISOString()): Op[] {
    return this.batch(() => {
      const inverse: Op[] = [];
      for (const op of ops) inverse.unshift(...this.apply(op, now));
      return inverse;
    });
  }

  /** Takes a node as the server has it, except what `guarded` names, which stays as it is here. */
  applyRemote(remote: Node, guarded: ReadonlySet<Guarded>): void {
    const local = this.#nodes.get(remote.id);
    if (!local) {
      this.batch(() => this.#put(remote));
      return;
    }
    const next: Record<string, unknown> = { ...local };
    let changed = false;
    const take = (key: keyof Node) => {
      if (local[key] !== remote[key]) {
        next[key] = remote[key];
        changed = true;
      }
    };
    if (!guarded.has("place")) {
      take("parentId");
      take("rank");
    }
    if (!guarded.has("deletedAt")) take("deletedAt");
    for (const f of FIELD_NAMES) if (!guarded.has(f)) take(f);
    if (changed) this.batch(() => this.#put(next as unknown as Node));
  }

  subscribeNode(id: string, listener: Listener): () => void {
    return subscribe(this.#nodeListeners, id, listener);
  }

  subscribeChildren(parentId: string | null, listener: Listener): () => void {
    return subscribe(this.#kidsListeners, keyOf(parentId), listener);
  }

  /** Called after every batch of changes. */
  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  // Inserts or replaces a node, keeping the child lists sorted.
  #put(next: Node): void {
    const prev = this.#nodes.get(next.id);
    this.#nodes.set(next.id, next);
    this.#changedNodes.add(next.id);
    if (!prev) {
      this.#insertChild(next);
    } else if (prev.parentId !== next.parentId || prev.rank !== next.rank) {
      this.#removeChild(prev);
      this.#insertChild(next);
    } else if (prev.deletedAt !== next.deletedAt || (prev.completedAt === null) !== (next.completedAt === null)) {
      // Which children are shown changed: a new array tells the parent's subscribers.
      const key = keyOf(next.parentId);
      this.#kids.set(key, [...this.children(next.parentId)]);
      this.#changedKids.add(key);
    }
  }

  #insertChild(node: Node): void {
    const key = keyOf(node.parentId);
    const list = [...this.children(node.parentId)];
    // Binary search for the first sibling that sorts after the node.
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (compareSiblings(this.#nodes.get(list[mid]!)!, node) < 0) lo = mid + 1;
      else hi = mid;
    }
    list.splice(lo, 0, node.id);
    this.#kids.set(key, list);
    this.#changedKids.add(key);
  }

  #removeChild(node: Node): void {
    const key = keyOf(node.parentId);
    const list = this.children(node.parentId).filter((id) => id !== node.id);
    if (list.length > 0) this.#kids.set(key, list);
    else this.#kids.delete(key);
    this.#changedKids.add(key);
  }

  #notify(): void {
    if (!this.#changedAll && this.#changedNodes.size === 0 && this.#changedKids.size === 0) return;
    this.#version++;
    const all = this.#changedAll;
    const nodes = all ? [...this.#nodeListeners.keys()] : [...this.#changedNodes];
    const kids = all ? [...this.#kidsListeners.keys()] : [...this.#changedKids];
    this.#changedAll = false;
    this.#changedNodes.clear();
    this.#changedKids.clear();
    for (const id of nodes) for (const l of this.#nodeListeners.get(id) ?? []) l();
    for (const key of kids) for (const l of this.#kidsListeners.get(key) ?? []) l();
    for (const l of this.#listeners) l();
  }
}

function subscribe(map: Map<string, Set<Listener>>, key: string, listener: Listener): () => void {
  let set = map.get(key);
  if (!set) map.set(key, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0 && map.get(key) === set) map.delete(key);
  };
}
