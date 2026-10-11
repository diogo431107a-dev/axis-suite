// What the browser and the API send each other: a node of the tree, and the operations that
// change it. The server and the web app both import this file, so it uses no Node or DOM APIs.

/** One bullet. Siblings are ordered by (rank, id), compared with plain < (never localeCompare). */
export interface Node {
  /** A UUID, made by the browser that created the node. */
  id: string;
  /** null for a top-level bullet. */
  parentId: string | null;
  /** Fractional index among the siblings (the fractional-indexing package). */
  rank: string;
  /** One line of inline markdown. */
  content: string;
  /** Any number of lines. */
  note: string;
  /** ISO timestamp, or null while not completed. */
  completedAt: string | null;
  collapsed: boolean;
  starred: boolean;
  /** Set on the root of a deleted subtree only. Its descendants stay as they were. */
  deletedAt: string | null;
}

/** The fields an update may change. */
export interface NodeFields {
  content: string;
  note: string;
  completedAt: string | null;
  collapsed: boolean;
  starred: boolean;
}

export type FieldName = keyof NodeFields;
export const FIELD_NAMES: readonly FieldName[] = ["content", "note", "completedAt", "collapsed", "starred"];

/**
 * A change to one node. Every op can be applied twice with the same result, so a batch whose
 * answer got lost can simply be sent again. A create of an id the user already has changes
 * nothing: it was sent before, and the node may have been edited since. (Redoing an undone
 * create is a restore.)
 */
export type Op =
  | ({ op: "create"; id: string; parentId: string | null; rank: string } & Partial<NodeFields>)
  | ({ op: "update"; id: string } & Partial<NodeFields>)
  | { op: "move"; id: string; parentId: string | null; rank: string }
  | { op: "delete"; id: string }
  | { op: "restore"; id: string };

/**
 * Every API request from the page names the user whose tree it shows, in this header (the event
 * stream, which can't send headers, uses ?user=). The API answers 409 if someone else is signed in.
 */
export const USER_HEADER = "X-Yggdrasil-User";

/** POST /api/ops */
export interface OpsRequest {
  /** Identifies the browser tab, so it can recognise its own changes in the event stream. */
  clientId: string;
  ops: Op[];
}

/** The answer to POST /api/ops: the ops refused, and the revision the batch was saved as. */
export interface OpsResponse {
  /** null if the batch changed nothing, e.g. because it was sent before and already applied. */
  rev: number | null;
  rejected: { index: number; reason: string }[];
}

/** GET /api/tree: every node the user can see. */
export interface TreeResponse {
  rev: number;
  nodes: Node[];
}

/**
 * GET /api/changes?since=N: every node changed after revision N, deleted ones included. reset
 * means nodes were purged since then, so the browser must load the whole tree again.
 */
export type ChangesResponse = { rev: number; nodes: Node[]; reset?: undefined } | { reset: true };

/** The data of a "rev" event on GET /api/events: the user's tree changed. */
export interface RevEvent {
  rev: number;
  /** The tab that made the change. */
  clientId: string;
}

export const LIMITS = {
  /** Characters in content or note. */
  fieldChars: 100_000,
  /** Ops in one POST /api/ops. */
  opsPerBatch: 5_000,
  /** Characters in a rank. Keys grow slowly; this is far beyond what editing produces. */
  rankChars: 1_000,
  /** Characters in a client id. */
  clientIdChars: 100,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RANK = /^[0-9A-Za-z]+$/;
// An ISO timestamp as Date.prototype.toISOString() writes it, or a date-only form.
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;

export const isUuid = (x: unknown): x is string => typeof x === "string" && UUID.test(x);

/** Sibling order: by rank, then id. Plain < agrees with SQLite's BINARY collation. */
export function compareSiblings(a: { rank: string; id: string }, b: { rank: string; id: string }): number {
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Why a field value is invalid, or null if it is fine. */
function fieldError(name: FieldName, value: unknown): string | null {
  switch (name) {
    case "content":
    case "note":
      if (typeof value !== "string") return `${name} must be a string`;
      return value.length > LIMITS.fieldChars ? `${name} is longer than ${LIMITS.fieldChars} characters` : null;
    case "completedAt":
      return value === null || (typeof value === "string" && value.length <= 40 && TIMESTAMP.test(value))
        ? null
        : "completedAt must be a timestamp or null";
    case "collapsed":
    case "starred":
      return typeof value === "boolean" ? null : `${name} must be true or false`;
  }
}

function placeError(o: Record<string, unknown>): string | null {
  if (o.parentId !== null && !isUuid(o.parentId)) return "parentId must be a UUID or null";
  if (typeof o.rank !== "string" || !RANK.test(o.rank) || o.rank.length > LIMITS.rankChars) return "invalid rank";
  return null;
}

/**
 * Checks the shape of one op from the network: an Op holding only known keys, or the reason it
 * is refused. Whether the user may apply it is for the server to decide.
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
      return typeof f === "string"
        ? f
        : { op: "create", id, parentId: o.parentId as string | null, rank: o.rank as string, ...f };
    }
    case "update": {
      const f = fields();
      return typeof f === "string" ? f : { op: "update", id, ...f };
    }
    case "move": {
      const err = placeError(o);
      return err ?? { op: "move", id, parentId: o.parentId as string | null, rank: o.rank as string };
    }
    case "delete":
    case "restore":
      return { op: o.op, id };
    default:
      return "unknown op";
  }
}
