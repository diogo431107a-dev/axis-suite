// What the page and the API send each other: maps, their nodes and arrows, the operations that
// change them, and the limits the server enforces. The server and the page both import this file,
// so it uses no Node or DOM APIs.

/** Sent with every request: the user the page belongs to. The API answers 409 if someone else is signed in. */
export const USER_HEADER = "X-Mimir-User";

/** Which side of the centre a main branch grows on. Only the root's children have one. */
export type Side = "left" | "right";
export const SIDES: readonly Side[] = ["left", "right"];

/** One node of a map. Siblings are ordered by (rank, id), compared with plain < (never localeCompare). */
export interface MapNode {
  /** A UUID, made by the browser that created the node (the server makes the root's). */
  id: string;
  /** null only for the root, the map's centre. */
  parentId: string | null;
  /** Fractional index among the siblings (the fractional-indexing package). */
  rank: string;
  /** "left" or "right" for a main branch (a child of the root), null for every other node. */
  side: Side | null;
  /** Any number of lines. The root's first line is the map's name. */
  text: string;
  collapsed: boolean;
  /** Set on the top of a deleted branch only. The nodes under it stay as they were. */
  deletedAt: string | null;
}

/** A relationship arrow from one node to another, outside the tree. */
export interface Arrow {
  id: string;
  fromId: string;
  toId: string;
  /** One line, may be "". */
  label: string;
  deletedAt: string | null;
}

/** The fields an update may change. Where a node is (parent, rank, side) changes only by a move. */
export interface NodeFields {
  text: string;
  collapsed: boolean;
}

export type FieldName = keyof NodeFields;
export const FIELD_NAMES: readonly FieldName[] = ["text", "collapsed"];

/**
 * A change to a map. Every op can be applied twice with the same result, so a batch whose answer
 * got lost can simply be sent again. A create of an id the map already has changes nothing: it
 * was sent before, and the node may have been edited since. (Redoing an undone create is a restore.)
 */
export type Op =
  | ({ op: "create"; id: string; parentId: string; rank: string; side: Side | null } & Partial<NodeFields>)
  | ({ op: "update"; id: string } & Partial<NodeFields>)
  | { op: "move"; id: string; parentId: string; rank: string; side: Side | null }
  | { op: "delete"; id: string }
  | { op: "restore"; id: string }
  | { op: "createArrow"; id: string; fromId: string; toId: string; label?: string }
  | { op: "updateArrow"; id: string; label: string }
  | { op: "deleteArrow"; id: string }
  | { op: "restoreArrow"; id: string };

export type NodeOp = Extract<Op, { op: "create" | "update" | "move" | "delete" | "restore" }>;
export type ArrowOp = Exclude<Op, NodeOp>;

export const isArrowOp = (op: Op): op is ArrowOp =>
  op.op === "createArrow" || op.op === "updateArrow" || op.op === "deleteArrow" || op.op === "restoreArrow";

/** A map in the sidebar. */
export interface MapSummary {
  id: string;
  /** The root's first line (see mapName). */
  name: string;
  /** When a change to its nodes or arrows was last saved. */
  updatedAt: string;
}

/** GET /api/maps/:id, POST /api/maps: the map with every live node, and its arrows. */
export interface MapData {
  map: MapSummary;
  /** The map's revision: raised by every saved batch that changes something. */
  rev: number;
  /** The root and every node not inside a deleted branch, in no particular order. */
  nodes: MapNode[];
  /** Every arrow not deleted, even if an end is: the page shows only those with both ends live. */
  arrows: Arrow[];
}

/** POST /api/maps/:id/ops */
export interface OpsRequest {
  ops: Op[];
}

/** The answer to POST /api/maps/:id/ops: the ops refused, and the revision the batch was saved as. */
export interface OpsResponse {
  /** null if the batch changed nothing, e.g. because it was sent before and already applied. */
  rev: number | null;
  rejected: { index: number; reason: string }[];
}

/**
 * GET /api/maps/:id/changes?since=N: every node and arrow changed after revision N, deleted ones
 * included. reset means old deleted nodes were purged since then: load the whole map again.
 */
export type ChangesResponse = { rev: number; nodes: MapNode[]; arrows: Arrow[]; reset?: undefined } | { reset: true };

/** POST /api/maps: a new map, its root holding `text`. */
export interface NewMap {
  text?: string;
}

/** POST /api/maps/:id/move: the map it goes after in the sidebar; null: first. */
export interface Move {
  afterId: string | null;
}

/** GET /api/export, GET /api/maps/:id/export, POST /api/restore. */
export interface ExportFile {
  format: "mimir";
  version: 1;
  exportedAt: string;
  maps: ExportMap[];
}

export interface ExportMap {
  root: ExportNode;
  arrows: ExportArrow[];
}

/** A node and its branch. Ids are left out; the order of `children` is the order shown. */
export interface ExportNode {
  text: string;
  /** Only on the root's children. Left out: Mimir picks the shorter side. */
  side?: Side;
  collapsed?: boolean;
  children?: ExportNode[];
}

/** Arrow ends are numbers of nodes in pre-order: 0 is the root, then each node before its children. */
export interface ExportArrow {
  from: number;
  to: number;
  label?: string;
}

/** POST /api/restore answers what it added. */
export interface RestoreResult {
  maps: number;
  nodes: number;
  /** arrows left out because an end was missing or both ends were the same node */
  droppedArrows: number;
  /** the new maps, in the file's order */
  ids: string[];
}

export const LIMITS = {
  maps: 200,
  /** node rows in one map, deleted ones included until they are purged */
  mapNodes: 5_000,
  /** arrow rows in one map, deleted ones included until they are purged */
  mapArrows: 500,
  /** node rows per user, every map together: keeps a whole backup well under the restore limit */
  userNodes: 100_000,
  textChars: 2_000,
  labelChars: 200,
  /** characters of the root's text shown as the map's name */
  nameChars: 100,
  /** ops in one POST /api/maps/:id/ops */
  opsPerBatch: 2_000,
  /** characters in a rank. Keys grow slowly; this is far beyond what editing produces. */
  rankChars: 1_000,
} as const;

/** Deleted nodes and arrows are kept this long, so undo keeps working, then purged for good. */
export const PURGE_AFTER_DAYS = 30;

export type ErrorCode = "invalid" | "not-found" | "too-many" | "other-user";

/** Every error answer: a sentence for people and, for the ones a page reacts to, a code. */
export interface ApiError {
  error: string;
  code?: ErrorCode;
}

/** The map's name: the root's first line, trimmed. */
export function mapName(rootText: string): string {
  const first = rootText.split("\n", 1)[0]!.trim();
  if (!first) return "Untitled map";
  return first.length > LIMITS.nameChars ? `${first.slice(0, LIMITS.nameChars - 1)}…` : first;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RANK = /^[0-9A-Za-z]+$/;

export const isUuid = (x: unknown): x is string => typeof x === "string" && UUID.test(x);

/** Sibling order: by rank, then id. Plain < agrees with SQLite's BINARY collation. */
export function compareSiblings(a: { rank: string; id: string }, b: { rank: string; id: string }): number {
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Why a node's text is refused, or null. */
export function textError(value: unknown): string | null {
  if (typeof value !== "string") return "text must be a string";
  return value.length > LIMITS.textChars ? `text is longer than ${LIMITS.textChars} characters` : null;
}

/** Why an arrow's label is refused, or null. */
export function labelError(value: unknown): string | null {
  if (typeof value !== "string") return "label must be a string";
  if (/[\r\n]/.test(value)) return "label must be one line";
  return value.length > LIMITS.labelChars ? `label is longer than ${LIMITS.labelChars} characters` : null;
}

function fieldError(name: FieldName, value: unknown): string | null {
  switch (name) {
    case "text":
      return textError(value);
    case "collapsed":
      return typeof value === "boolean" ? null : "collapsed must be true or false";
  }
}

function placeError(o: Record<string, unknown>): string | null {
  if (!isUuid(o.parentId)) return "parentId must be a UUID";
  if (typeof o.rank !== "string" || !RANK.test(o.rank) || o.rank.length > LIMITS.rankChars) return "invalid rank";
  if (o.side !== null && !SIDES.includes(o.side as Side)) return "side must be left, right or null";
  return null;
}

/**
 * Checks the shape of one op from the network: an Op holding only known keys, or the reason it
 * is refused. Whether it fits the map is for the server to decide.
 */
export function parseOp(x: unknown): Op | string {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return "not an object";
  const o = x as Record<string, unknown>;
  if (!isUuid(o.id)) return "id must be a UUID";
  const id = o.id;
  const fields = (): Partial<NodeFields> | string => {
    const out: Partial<NodeFields> = {};
    for (const name of FIELD_NAMES) {
      if (o[name] === undefined) continue;
      const err = fieldError(name, o[name]);
      if (err) return err;
      (out as Record<string, unknown>)[name] = o[name];
    }
    return out;
  };
  switch (o.op) {
    case "create": {
      const err = placeError(o);
      if (err) return err;
      const f = fields();
      if (typeof f === "string") return f;
      return {
        op: "create",
        id,
        parentId: o.parentId as string,
        rank: o.rank as string,
        side: o.side as Side | null,
        ...f,
      };
    }
    case "update": {
      const f = fields();
      return typeof f === "string" ? f : { op: "update", id, ...f };
    }
    case "move": {
      const err = placeError(o);
      return (
        err ?? { op: "move", id, parentId: o.parentId as string, rank: o.rank as string, side: o.side as Side | null }
      );
    }
    case "delete":
    case "restore":
    case "deleteArrow":
    case "restoreArrow":
      return { op: o.op, id };
    case "createArrow": {
      if (!isUuid(o.fromId) || !isUuid(o.toId)) return "fromId and toId must be UUIDs";
      if (o.fromId === o.toId) return "an arrow needs two different nodes";
      if (o.label !== undefined) {
        const err = labelError(o.label);
        if (err) return err;
      }
      const arrow: Op = { op: "createArrow", id, fromId: o.fromId, toId: o.toId };
      if (o.label !== undefined) arrow.label = o.label as string;
      return arrow;
    }
    case "updateArrow": {
      const err = labelError(o.label);
      return err ?? { op: "updateArrow", id, label: o.label as string };
    }
    default:
      return "unknown op";
  }
}
