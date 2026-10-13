// The tree in the browser: every node by id, the children of each node in order, and
// subscriptions so a component re-renders only when its own node or child list changes. It also
// knows the bullets shared with the user, which stay out of their own top level.
import {
  FIELD_NAMES,
  compareSiblings,
  type FieldName,
  type Node,
  type NodeFields,
  type Op,
  type Role,
  type Share,
  type SharedWithMe,
  type Shares,
} from "../../shared/protocol.ts";

type Listener = () => void;

/** What a server row may not overwrite because a local op on it hasn't landed yet. */
export type Guarded = FieldName | "place" | "deletedAt";

const ROOT = "";
/** Where the bullets shared with the user are listed: not a node id, so no node's children. */
const SHARED = "(shared with me)";
const keyOf = (parentId: string | null) => parentId ?? ROOT;
const NO_CHILDREN: readonly string[] = Object.freeze([]);
const NO_SHARES: readonly Share[] = Object.freeze([]);

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
  #structure = 0;
  #shapeChanged = false;
  // Notifications wait until the outermost batch() ends.
  #depth = 0;
  #changedNodes = new Set<string>();
  #changedKids = new Set<string>();
  #changedAll = false;
  /** Who the user shares their bullets with, by bullet. */
  #byMe = new Map<string, readonly Share[]>();
  /** The bullets shared with the user, by id. */
  #withMe = new Map<string, SharedWithMe>();
  #sharesJson = "";

  // A bullet shared with the user comes without its parent: it is listed apart from their own.
  #keyOf(node: Node): string {
    return node.parentId === null && this.#withMe.has(node.id) ? SHARED : keyOf(node.parentId);
  }

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

  /**
   * Counts changes to the tree's shape: child lists, which children are shown (deleted,
   * completed) and collapsing. Typing in a bullet doesn't change it.
   */
  get structure(): number {
    return this.#structure;
  }

  get size(): number {
    return this.#nodes.size;
  }

  all(): IterableIterator<Node> {
    return this.#nodes.values();
  }

  /** The tops of the bullets shared with the user, in no particular order. */
  sharedRoots(): readonly string[] {
    return this.#kids.get(SHARED) ?? NO_CHILDREN;
  }

  /** Who a bullet of the user's own is shared with. */
  sharesOf(id: string): readonly Share[] {
    return this.#byMe.get(id) ?? NO_SHARES;
  }

  /** The bullets of the user's own that they share. */
  sharedByMe(): string[] {
    return [...this.#byMe.keys()];
  }

  /** A bullet someone else shares with the user, if id is one. */
  sharedWithMe(id: string): SharedWithMe | undefined {
    return this.#withMe.get(id);
  }

  /**
   * The user's access to a node: theirs, or the best permission of the bullets shared with them
   * that it is in. `parents` gives the parents of nodes not in the store yet (made by the same
   * change).
   */
  roleOf(id: string | null, parents?: ReadonlyMap<string, string | null>): Role {
    let best: SharedWithMe["permission"] | null = null;
    for (let cur = id, steps = 0; cur !== null && steps < 100_000; steps++) {
      const share = this.#withMe.get(cur);
      if (share && (best === null || share.permission === "write")) best = share.permission;
      const node = this.#nodes.get(cur);
      cur = node ? node.parentId : (parents?.get(cur) ?? null);
    }
    return best === "write" ? "editor" : best === "read" ? "viewer" : "owner";
  }

  /** Takes the server's lists of shares. Returns whether they changed. */
  setShares(shares: Shares): boolean {
    const json = JSON.stringify(shares);
    if (json === this.#sharesJson) return false;
    this.#sharesJson = json;
    const before = [...this.#withMe.keys()].sort().join();
    this.#byMe = new Map(shares.byMe.map((s) => [s.id, s.shares]));
    this.#withMe = new Map(shares.withMe.map((s) => [s.id, s]));
    // Which bullets are listed apart changed: sort them out again.
    if ([...this.#withMe.keys()].sort().join() !== before) this.load([...this.#nodes.values()]);
    else this.batch(() => (this.#changedAll = true));
    return true;
  }

  /** Replaces the whole tree (and with `shares`, the lists of shares). */
  load(nodes: Node[], shares?: Shares): void {
    if (shares) {
      this.#sharesJson = JSON.stringify(shares);
      this.#byMe = new Map(shares.byMe.map((s) => [s.id, s.shares]));
      this.#withMe = new Map(shares.withMe.map((s) => [s.id, s]));
    }
    this.#nodes = new Map(nodes.map((n) => [n.id, n]));
    const groups = new Map<string, Node[]>();
    for (const n of nodes) {
      const key = this.#keyOf(n);
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
    if (prev && prev.collapsed !== next.collapsed) this.#shapeChanged = true;
    if (!prev) {
      this.#insertChild(next);
    } else if (prev.parentId !== next.parentId || prev.rank !== next.rank) {
      this.#removeChild(prev);
      this.#insertChild(next);
    } else if (prev.deletedAt !== next.deletedAt || (prev.completedAt === null) !== (next.completedAt === null)) {
      // Which children are shown changed: a new array tells the parent's subscribers.
      const key = this.#keyOf(next);
      this.#kids.set(key, [...(this.#kids.get(key) ?? NO_CHILDREN)]);
      this.#changedKids.add(key);
    }
  }

  #insertChild(node: Node): void {
    const key = this.#keyOf(node);
    const list = [...(this.#kids.get(key) ?? NO_CHILDREN)];
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
    const key = this.#keyOf(node);
    const list = (this.#kids.get(key) ?? NO_CHILDREN).filter((id) => id !== node.id);
    if (list.length > 0) this.#kids.set(key, list);
    else this.#kids.delete(key);
    this.#changedKids.add(key);
  }

  #notify(): void {
    if (!this.#changedAll && this.#changedNodes.size === 0 && this.#changedKids.size === 0) return;
    this.#version++;
    if (this.#changedAll || this.#changedKids.size > 0 || this.#shapeChanged) this.#structure++;
    this.#shapeChanged = false;
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
