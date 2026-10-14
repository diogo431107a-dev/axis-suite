// Applies batches of ops to one map: the only place nodes and arrows are written while a map is
// edited. Each op is checked on its own; refused ones are listed and the rest still apply. The
// caller has already checked that the map is the user's.
//
// The server never rewrites a value it is sent: the page has already shown it, so anything the
// server changed would leave the page and the database disagreeing. It refuses instead.
import type { DatabaseSync, StatementSync } from "node:sqlite";
import {
  FIELD_NAMES,
  LIMITS,
  parseOp,
  type Arrow,
  type MapNode,
  type NodeFields,
  type Op,
  type OpsResponse,
  type Side,
} from "../shared/protocol.ts";
import { invalid, transaction } from "./errors.ts";

export interface NodeRow {
  id: string;
  map_id: string;
  parent_id: string | null;
  rank: string;
  side: Side | null;
  text: string;
  collapsed: number;
  deleted_at: string | null;
}

export interface ArrowRow {
  id: string;
  map_id: string;
  from_id: string;
  to_id: string;
  label: string;
  deleted_at: string | null;
}

export const NODE_COLUMNS = "id, map_id, parent_id, rank, side, text, collapsed, deleted_at";
export const ARROW_COLUMNS = "id, map_id, from_id, to_id, label, deleted_at";

export const toNode = (r: NodeRow): MapNode => ({
  id: r.id,
  parentId: r.parent_id,
  rank: r.rank,
  side: r.side,
  text: r.text,
  collapsed: r.collapsed === 1,
  deletedAt: r.deleted_at,
});

export const toArrow = (r: ArrowRow): Arrow => ({
  id: r.id,
  fromId: r.from_id,
  toId: r.to_id,
  label: r.label,
  deletedAt: r.deleted_at,
});

/** A parent chain longer than this is a bug (a cycle), not a deep map. */
const MAX_DEPTH = 100_000;

const ROOT_FIXED = "the centre of a map can't be moved or deleted";

/** What one batch has counted so far, so limits are checked without a query per op. */
interface BatchState {
  mapId: string;
  owner: string;
  nodeRows: number | null;
  userRows: number | null;
  arrowRows: number | null;
}

export function createOps(db: DatabaseSync) {
  const selectNode = db.prepare(`SELECT ${NODE_COLUMNS} FROM nodes WHERE id = ?`);
  const selectParent = db.prepare("SELECT parent_id FROM nodes WHERE id = ?");
  const insertNode = db.prepare(`
    INSERT INTO nodes (id, map_id, parent_id, rank, side, text, collapsed, rev, created_at, updated_at)
    VALUES ($id, $map, $parent, $rank, $side, $text, $collapsed, $rev, $now, $now)`);
  const moveNode = db.prepare(
    "UPDATE nodes SET parent_id = ?, rank = ?, side = ?, rev = ?, updated_at = ? WHERE id = ?",
  );
  const setNodeDeleted = db.prepare("UPDATE nodes SET deleted_at = ?, rev = ?, updated_at = ? WHERE id = ?");
  // A restored branch's nodes count as changed, so a page that loaded after the delete gets them.
  const touchDescendants = db.prepare(`
    WITH RECURSIVE sub(id) AS (
      SELECT id FROM nodes WHERE parent_id = $id
      UNION ALL
      SELECT n.id FROM nodes n JOIN sub ON n.parent_id = sub.id
    )
    UPDATE nodes SET rev = $rev WHERE id IN (SELECT id FROM sub)`);

  const selectArrow = db.prepare(`SELECT ${ARROW_COLUMNS} FROM arrows WHERE id = ?`);
  const insertArrow = db.prepare(`
    INSERT INTO arrows (id, map_id, from_id, to_id, label, rev, created_at, updated_at)
    VALUES ($id, $map, $from, $to, $label, $rev, $now, $now)`);
  const setArrowLabel = db.prepare("UPDATE arrows SET label = ?, rev = ?, updated_at = ? WHERE id = ?");
  const setArrowDeleted = db.prepare("UPDATE arrows SET deleted_at = ?, rev = ?, updated_at = ? WHERE id = ?");

  const countMapNodes = db.prepare("SELECT count(*) AS n FROM nodes WHERE map_id = ?");
  const countUserNodes = db.prepare(
    "SELECT count(*) AS n FROM nodes WHERE map_id IN (SELECT id FROM maps WHERE owner = ?)",
  );
  const countMapArrows = db.prepare("SELECT count(*) AS n FROM arrows WHERE map_id = ?");
  const selectMapRev = db.prepare("SELECT rev FROM maps WHERE id = ?");
  const setMapRev = db.prepare("UPDATE maps SET rev = ?, updated_at = ? WHERE id = ?");

  const updateStatements = new Map<string, StatementSync>();

  const count = (stmt: StatementSync, arg: string) => (stmt.get(arg) as { n: number }).n;
  const nodeRow = (id: string) => selectNode.get(id) as NodeRow | undefined;

  function updateFields(id: string, fields: Partial<NodeFields>, rev: number, now: string): void {
    const names = FIELD_NAMES.filter((f) => fields[f] !== undefined);
    const key = names.join(",");
    let stmt = updateStatements.get(key);
    if (!stmt) {
      const sets = names.map((f) => `${f} = ?`).join(", ");
      stmt = db.prepare(`UPDATE nodes SET ${sets}, rev = ?, updated_at = ? WHERE id = ?`);
      updateStatements.set(key, stmt);
    }
    const values = names.map((f) => {
      const v = fields[f]!;
      return typeof v === "boolean" ? (v ? 1 : 0) : v;
    });
    stmt.run(...values, rev, now, id);
  }

  /** Whether `ancestor` is `id` itself or one of its ancestors, walking up from `id`. */
  function isAncestorOrSelf(ancestor: string, id: string | null): boolean {
    for (let cur = id, steps = 0; cur !== null; steps++) {
      if (cur === ancestor) return true;
      if (steps > MAX_DEPTH) throw new Error(`Parent chain of ${id} is too deep or has a cycle`);
      cur = (selectParent.get(cur) as { parent_id: string | null } | undefined)?.parent_id ?? null;
    }
    return false;
  }

  /** Why a node can't go under `parent` with `side`, or null. */
  function placeRefusal(batch: BatchState, parent: NodeRow | undefined, side: Side | null): string | null {
    if (!parent || parent.map_id !== batch.mapId) return "unknown parent";
    const mainBranch = parent.parent_id === null;
    if (mainBranch && side === null) return "a main branch needs a side";
    if (!mainBranch && side !== null) return "only main branches have a side";
    return null;
  }

  /** Room for one more node in the map and for the user. */
  function nodeRoom(batch: BatchState): string | null {
    batch.nodeRows ??= count(countMapNodes, batch.mapId);
    batch.userRows ??= count(countUserNodes, batch.owner);
    if (batch.nodeRows >= LIMITS.mapNodes) return `a map holds at most ${LIMITS.mapNodes} nodes`;
    if (batch.userRows >= LIMITS.userNodes) return `at most ${LIMITS.userNodes} nodes in all your maps`;
    batch.nodeRows++;
    batch.userRows++;
    return null;
  }

  /** Applies one op. true: it changed something; false: nothing to do; a string: why it is refused. */
  function applyOp(batch: BatchState, op: Op, rev: number, now: string): string | boolean {
    switch (op.op) {
      case "create": {
        const row = nodeRow(op.id);
        // Sent before and saved. The node may have changed since, so it stays as it is.
        if (row) return row.map_id === batch.mapId ? false : "id already in use";
        const refusal = placeRefusal(batch, nodeRow(op.parentId), op.side) ?? nodeRoom(batch);
        if (refusal) return refusal;
        insertNode.run({
          $id: op.id,
          $map: batch.mapId,
          $parent: op.parentId,
          $rank: op.rank,
          $side: op.side,
          $text: op.text ?? "",
          $collapsed: op.collapsed ? 1 : 0,
          $rev: rev,
          $now: now,
        });
        return true;
      }
      case "update": {
        const row = nodeRow(op.id);
        if (!row || row.map_id !== batch.mapId) return "unknown node";
        if (op.collapsed === true && row.parent_id === null) return "the centre of a map can't be folded";
        const changed: Partial<NodeFields> = {};
        if (op.text !== undefined && op.text !== row.text) changed.text = op.text;
        if (op.collapsed !== undefined && op.collapsed !== (row.collapsed === 1)) changed.collapsed = op.collapsed;
        if (Object.keys(changed).length === 0) return false;
        updateFields(row.id, changed, rev, now);
        return true;
      }
      case "move": {
        const row = nodeRow(op.id);
        if (!row || row.map_id !== batch.mapId) return "unknown node";
        if (row.parent_id === null) return ROOT_FIXED;
        if (row.parent_id === op.parentId && row.rank === op.rank && row.side === op.side) return false;
        const refusal = placeRefusal(batch, nodeRow(op.parentId), op.side);
        if (refusal) return refusal;
        if (isAncestorOrSelf(op.id, op.parentId)) return "would put a node inside itself";
        moveNode.run(op.parentId, op.rank, op.side, rev, now, op.id);
        return true;
      }
      case "delete":
      case "restore": {
        const row = nodeRow(op.id);
        if (!row || row.map_id !== batch.mapId) return "unknown node";
        if (row.parent_id === null) return ROOT_FIXED;
        if ((row.deleted_at !== null) === (op.op === "delete")) return false;
        setNodeDeleted.run(op.op === "delete" ? now : null, rev, now, op.id);
        if (op.op === "restore") touchDescendants.run({ $id: op.id, $rev: rev });
        return true;
      }
      case "createArrow": {
        const row = selectArrow.get(op.id) as ArrowRow | undefined;
        if (row) return row.map_id === batch.mapId ? false : "id already in use";
        const from = nodeRow(op.fromId);
        const to = nodeRow(op.toId);
        if (!from || !to || from.map_id !== batch.mapId || to.map_id !== batch.mapId) return "unknown node";
        batch.arrowRows ??= count(countMapArrows, batch.mapId);
        if (batch.arrowRows >= LIMITS.mapArrows) return `a map holds at most ${LIMITS.mapArrows} arrows`;
        batch.arrowRows++;
        insertArrow.run({
          $id: op.id,
          $map: batch.mapId,
          $from: op.fromId,
          $to: op.toId,
          $label: op.label ?? "",
          $rev: rev,
          $now: now,
        });
        return true;
      }
      case "updateArrow":
      case "deleteArrow":
      case "restoreArrow": {
        const row = selectArrow.get(op.id) as ArrowRow | undefined;
        if (!row || row.map_id !== batch.mapId) return "unknown arrow";
        if (op.op === "updateArrow") {
          if (row.label === op.label) return false;
          setArrowLabel.run(op.label, rev, now, op.id);
          return true;
        }
        if ((row.deleted_at !== null) === (op.op === "deleteArrow")) return false;
        setArrowDeleted.run(op.op === "deleteArrow" ? now : null, rev, now, op.id);
        return true;
      }
    }
  }

  return {
    /**
     * Applies a batch from the network to the map `mapId` of `owner`, in one transaction, as one
     * new revision of the map.
     */
    applyOps(owner: string, mapId: string, ops: unknown): OpsResponse {
      if (!Array.isArray(ops)) invalid("ops must be a list");
      if (ops.length > LIMITS.opsPerBatch) invalid(`At most ${LIMITS.opsPerBatch} ops per request`);
      return transaction(db, () => {
        const rev = (selectMapRev.get(mapId) as { rev: number }).rev + 1;
        const now = new Date().toISOString();
        const batch: BatchState = { mapId, owner, nodeRows: null, userRows: null, arrowRows: null };
        const rejected: OpsResponse["rejected"] = [];
        let changed = false;
        ops.forEach((raw, index) => {
          const op = parseOp(raw);
          const result = typeof op === "string" ? op : applyOp(batch, op, rev, now);
          if (typeof result === "string") rejected.push({ index, reason: result });
          else changed ||= result;
        });
        if (changed) setMapRev.run(rev, now, mapId);
        return { rev: changed ? rev : null, rejected };
      });
    },
  };
}
