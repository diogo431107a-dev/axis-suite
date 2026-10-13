// One map in the browser: every node by id, the children of each node in order, and the arrows.
// Changes come as ops (applied here first, then saved), or as rows from the server. Whoever
// subscribes hears once after each batch of changes; the map is laid out again from scratch then.
import {
  FIELD_NAMES,
  compareSiblings,
  type Arrow,
  type FieldName,
  type MapNode,
  type NodeFields,
  type Op,
} from "../../shared/protocol.ts";

type Listener = () => void;

/**
 * What a server row may not overwrite because a local op on it hasn't landed yet: a node's fields,
 * its place (parent, rank and side) or its deletion; an arrow's label or deletion.
 */
export type Guarded = FieldName | "place" | "deletedAt" | "label";

const NO_CHILDREN: readonly string[] = Object.freeze([]);

export function newNode(id: string, parentId: string | null, rank: string, side: MapNode["side"]): MapNode {
  return { id, parentId, rank, side, text: "", collapsed: false, deletedAt: null };
}

export class MapStore {
  #nodes = new Map<string, MapNode>();
  /** Child ids per parent, sorted, deleted ones included. */
  #kids = new Map<string, readonly string[]>();
  #arrows = new Map<string, Arrow>();
  #rootId = "";
  #listeners = new Set<Listener>();
  #version = 0;
  // Notifications wait until the outermost batch() ends.
  #depth = 0;
  #changed = false;

  /** The map's centre. */
  get rootId(): string {
    return this.#rootId;
  }

  /** Raised by every batch that changed something. */
  get version(): number {
    return this.#version;
  }

  get(id: string): MapNode | undefined {
    return this.#nodes.get(id);
  }

  /** The children of a node, deleted ones included, in order. */
  children(parentId: string): readonly string[] {
    return this.#kids.get(parentId) ?? NO_CHILDREN;
  }

  /** The children that aren't deleted, in order. */
  liveChildren(parentId: string): string[] {
    return this.children(parentId).filter((id) => this.#nodes.get(id)?.deletedAt === null);
  }

  /** Whether a node is shown in the map: neither it nor anything above it is deleted. */
  isLive(id: string): boolean {
    for (let node = this.#nodes.get(id); node; node = node.parentId ? this.#nodes.get(node.parentId) : undefined) {
      if (node.deletedAt !== null) return false;
      if (node.parentId === null) return true;
    }
    return false;
  }

  arrow(id: string): Arrow | undefined {
    return this.#arrows.get(id);
  }

  arrows(): IterableIterator<Arrow> {
    return this.#arrows.values();
  }

  nodes(): IterableIterator<MapNode> {
    return this.#nodes.values();
  }

  /** Replaces the whole map. */
  load(nodes: readonly MapNode[], arrows: readonly Arrow[]): void {
    this.#nodes = new Map(nodes.map((n) => [n.id, n]));
    this.#arrows = new Map(arrows.map((a) => [a.id, a]));
    const groups = new Map<string, MapNode[]>();
    for (const n of nodes) {
      if (n.parentId === null) {
        this.#rootId = n.id;
        continue;
      }
      const group = groups.get(n.parentId);
      if (group) group.push(n);
      else groups.set(n.parentId, [n]);
    }
    this.#kids = new Map();
    for (const [key, group] of groups)
      this.#kids.set(
        key,
        group.sort(compareSiblings).map((n) => n.id),
      );
    this.batch(() => {
      this.#changed = true;
    });
  }

  /** Runs fn, then tells subscribers once about everything it changed. */
  batch<T>(fn: () => T): T {
    this.#depth++;
    try {
      return fn();
    } finally {
      if (--this.#depth === 0 && this.#changed) {
        this.#changed = false;
        this.#version++;
        for (const l of this.#listeners) l();
      }
    }
  }

  /**
   * Applies a local op the way the server will. Returns the ops that undo it, or none if it
   * changed nothing.
   */
  apply(op: Op, now: string): Op[] {
    switch (op.op) {
      case "create": {
        if (this.#nodes.has(op.id)) return []; // as on the server: already there, left alone
        const { op: _op, id, parentId, rank, side, ...fields } = op;
        this.batch(() => this.#put({ ...newNode(id, parentId, rank, side), ...fields }));
        return [{ op: "delete", id }];
      }
      case "update": {
        const node = this.#nodes.get(op.id);
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
        this.batch(() => this.#put(next as unknown as MapNode));
        return [{ op: "update", id: op.id, ...before }];
      }
      case "move": {
        const node = this.#nodes.get(op.id);
        if (!node || (node.parentId === op.parentId && node.rank === op.rank && node.side === op.side)) return [];
        this.batch(() => this.#put({ ...node, parentId: op.parentId, rank: op.rank, side: op.side }));
        return [{ op: "move", id: op.id, parentId: node.parentId!, rank: node.rank, side: node.side }];
      }
      case "delete":
      case "restore": {
        const node = this.#nodes.get(op.id);
        if (!node || (node.deletedAt !== null) === (op.op === "delete")) return [];
        this.batch(() => this.#put({ ...node, deletedAt: op.op === "delete" ? now : null }));
        return [{ op: op.op === "delete" ? "restore" : "delete", id: op.id }];
      }
      case "createArrow": {
        if (this.#arrows.has(op.id)) return [];
        const arrow: Arrow = { id: op.id, fromId: op.fromId, toId: op.toId, label: op.label ?? "", deletedAt: null };
        this.batch(() => this.#putArrow(arrow));
        return [{ op: "deleteArrow", id: op.id }];
      }
      case "updateArrow": {
        const arrow = this.#arrows.get(op.id);
        if (!arrow || arrow.label === op.label) return [];
        this.batch(() => this.#putArrow({ ...arrow, label: op.label }));
        return [{ op: "updateArrow", id: op.id, label: arrow.label }];
      }
      case "deleteArrow":
      case "restoreArrow": {
        const arrow = this.#arrows.get(op.id);
        if (!arrow || (arrow.deletedAt !== null) === (op.op === "deleteArrow")) return [];
        this.batch(() => this.#putArrow({ ...arrow, deletedAt: op.op === "deleteArrow" ? now : null }));
        return [{ op: op.op === "deleteArrow" ? "restoreArrow" : "deleteArrow", id: op.id }];
      }
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
  applyRemoteNode(remote: MapNode, guarded: ReadonlySet<Guarded>): void {
    const local = this.#nodes.get(remote.id);
    if (!local) {
      this.batch(() => this.#put(remote));
      return;
    }
    const next: Record<string, unknown> = { ...local };
    let changed = false;
    const take = (key: keyof MapNode) => {
      if (local[key] !== remote[key]) {
        next[key] = remote[key];
        changed = true;
      }
    };
    if (!guarded.has("place")) {
      take("parentId");
      take("rank");
      take("side");
    }
    if (!guarded.has("deletedAt")) take("deletedAt");
    for (const f of FIELD_NAMES) if (!guarded.has(f)) take(f);
    if (changed) this.batch(() => this.#put(next as unknown as MapNode));
  }

  /** Takes an arrow as the server has it, except what `guarded` names. */
  applyRemoteArrow(remote: Arrow, guarded: ReadonlySet<Guarded>): void {
    const local = this.#arrows.get(remote.id);
    if (!local) {
      this.batch(() => this.#putArrow(remote));
      return;
    }
    const next = { ...local };
    if (!guarded.has("label")) next.label = remote.label;
    if (!guarded.has("deletedAt")) next.deletedAt = remote.deletedAt;
    if (next.label !== local.label || next.deletedAt !== local.deletedAt) this.batch(() => this.#putArrow(next));
  }

  /** Called after every batch of changes. */
  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  // Inserts or replaces a node, keeping the child lists sorted.
  #put(next: MapNode): void {
    const prev = this.#nodes.get(next.id);
    this.#nodes.set(next.id, next);
    this.#changed = true;
    if (next.parentId === null) this.#rootId = next.id;
    if (!prev) {
      this.#insertChild(next);
    } else if (prev.parentId !== next.parentId || prev.rank !== next.rank) {
      this.#removeChild(prev);
      this.#insertChild(next);
    }
  }

  #putArrow(next: Arrow): void {
    this.#arrows.set(next.id, next);
    this.#changed = true;
  }

  #insertChild(node: MapNode): void {
    if (node.parentId === null) return;
    const list = [...(this.#kids.get(node.parentId) ?? NO_CHILDREN)];
    // Binary search for the first sibling that sorts after the node.
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (compareSiblings(this.#nodes.get(list[mid]!)!, node) < 0) lo = mid + 1;
      else hi = mid;
    }
    list.splice(lo, 0, node.id);
    this.#kids.set(node.parentId, list);
  }

  #removeChild(node: MapNode): void {
    if (node.parentId === null) return;
    const list = (this.#kids.get(node.parentId) ?? NO_CHILDREN).filter((id) => id !== node.id);
    if (list.length > 0) this.#kids.set(node.parentId, list);
    else this.#kids.delete(node.parentId);
  }
}
