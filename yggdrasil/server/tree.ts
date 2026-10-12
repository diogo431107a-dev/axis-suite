// Every read and write of nodes goes through here, so this is the one place that decides who
// may see or change a node.
import type { DatabaseSync } from "node:sqlite";
import {
  FIELD_NAMES,
  LIMITS,
  parseOp,
  type ChangesResponse,
  type Node,
  type NodeFields,
  type Op,
  type OpsResponse,
  type TreeResponse,
} from "../shared/protocol.ts";

/** A problem with a whole batch rather than one op. Answered with 400. */
export class BatchError extends Error {}

/** Deleted bullets are kept this long, then purged for good. */
export const PURGE_AFTER_DAYS = 30;

interface Row {
  id: string;
  owner: string;
  parent_id: string | null;
  rank: string;
  content: string;
  note: string;
  completed_at: string | null;
  collapsed: number;
  starred: number;
  deleted_at: string | null;
}

const toNode = (r: Row): Node => ({
  id: r.id,
  parentId: r.parent_id,
  rank: r.rank,
  content: r.content,
  note: r.note,
  completedAt: r.completed_at,
  collapsed: r.collapsed === 1,
  starred: r.starred === 1,
  deletedAt: r.deleted_at,
});

// Columns of the fields an update may change.
const COLUMN: Record<keyof NodeFields, string> = {
  content: "content",
  note: "note",
  completedAt: "completed_at",
  collapsed: "collapsed",
  starred: "starred",
};
const toColumnValue = (v: string | boolean | null) => (typeof v === "boolean" ? (v ? 1 : 0) : v);

// A walk up the parents never needs more steps than this; more means the data is broken.
const MAX_DEPTH = 100_000;

export function createTree(db: DatabaseSync) {
  const COLUMNS = "id, owner, parent_id, rank, content, note, completed_at, collapsed, starred, deleted_at";

  const getMeta = db.prepare("SELECT value FROM meta WHERE key = ?");
  const setMeta = db.prepare("UPDATE meta SET value = ? WHERE key = ?");
  const selectNode = db.prepare(`SELECT ${COLUMNS} FROM nodes WHERE id = ?`);
  const selectParent = db.prepare("SELECT parent_id FROM nodes WHERE id = ?");
  // The nodes the user can see: from the top-level ones down, never through a deleted one.
  const selectLive = db.prepare(`
    WITH RECURSIVE live(id) AS (
      SELECT id FROM nodes WHERE owner = $owner AND parent_id IS NULL AND deleted_at IS NULL
      UNION ALL
      SELECT n.id FROM nodes n JOIN live ON n.parent_id = live.id WHERE n.deleted_at IS NULL
    )
    SELECT ${COLUMNS} FROM nodes JOIN live USING (id)`);
  const selectChanged = db.prepare(`SELECT ${COLUMNS} FROM nodes WHERE owner = ? AND rev > ?`);
  const insertNode = db.prepare(`
    INSERT INTO nodes (id, owner, parent_id, rank, content, note, completed_at, collapsed, starred, rev, created_at, updated_at)
    VALUES ($id, $owner, $parent, $rank, $content, $note, $completed, $collapsed, $starred, $rev, $now, $now)`);
  const moveNode = db.prepare("UPDATE nodes SET parent_id = ?, rank = ?, rev = ?, updated_at = ? WHERE id = ?");
  const setDeleted = db.prepare("UPDATE nodes SET deleted_at = ?, rev = ?, updated_at = ? WHERE id = ?");
  // A restored subtree's nodes count as changed, so a tab that loaded after the delete gets them.
  const touchDescendants = db.prepare(`
    WITH RECURSIVE sub(id) AS (
      SELECT id FROM nodes WHERE parent_id = $id
      UNION ALL
      SELECT n.id FROM nodes n JOIN sub ON n.parent_id = sub.id
    )
    UPDATE nodes SET rev = $rev WHERE id IN (SELECT id FROM sub)`);
  const purgeDeleted = db.prepare("DELETE FROM nodes WHERE deleted_at IS NOT NULL AND deleted_at < ?");
  // $known: a JSON array of usernames.
  const UNKNOWN_OWNER = "owner NOT IN (SELECT value FROM json_each($known))";
  const countUnknownOwners = db.prepare(
    `SELECT owner, count(*) AS rows FROM nodes WHERE ${UNKNOWN_OWNER} GROUP BY owner ORDER BY owner`,
  );
  const deleteUnknownOwners = db.prepare(`DELETE FROM nodes WHERE ${UNKNOWN_OWNER}`);
  // One statement per set of changed fields, compiled the first time it is needed.
  const updateStatements = new Map<string, ReturnType<DatabaseSync["prepare"]>>();

  const meta = (key: "rev" | "purged_rev") => (getMeta.get(key) as { value: number }).value;

  function transaction<T>(fn: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  function updateFields(id: string, fields: Partial<NodeFields>, rev: number, now: string): void {
    const names = FIELD_NAMES.filter((f) => fields[f] !== undefined);
    const key = names.join(",");
    let stmt = updateStatements.get(key);
    if (!stmt) {
      const sets = names.map((f) => `${COLUMN[f]} = ?`).join(", ");
      stmt = db.prepare(`UPDATE nodes SET ${sets}, rev = ?, updated_at = ? WHERE id = ?`);
      updateStatements.set(key, stmt);
    }
    stmt.run(...names.map((f) => toColumnValue(fields[f]!)), rev, now, id);
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

  /**
   * Applies one op as `owner` at revision `rev`. Returns why it was refused, or whether it
   * changed anything: ops that would leave a node as it is write nothing, so a batch sent
   * twice changes nothing the second time.
   */
  function applyOp(owner: string, op: Op, rev: number, now: string): string | boolean {
    const row = selectNode.get(op.id) as Row | undefined;
    if (row && row.owner !== owner) return op.op === "create" ? "id already in use" : "unknown node";
    if (!row && op.op !== "create") return "unknown node";
    // The create was sent before and saved. The node may have changed since, so it stays as it is.
    if (row && op.op === "create") return false;

    if ((op.op === "create" || op.op === "move") && op.parentId !== null) {
      const parent = selectNode.get(op.parentId) as Row | undefined;
      if (!parent || parent.owner !== owner) return "unknown parent";
      if (isAncestorOrSelf(op.id, op.parentId)) return "would put a bullet inside itself";
    }

    switch (op.op) {
      case "create": {
        const { op: _op, id, parentId, rank, ...fields } = op;
        insertNode.run({
          $id: id,
          $owner: owner,
          $parent: parentId,
          $rank: rank,
          $content: fields.content ?? "",
          $note: fields.note ?? "",
          $completed: fields.completedAt ?? null,
          $collapsed: fields.collapsed ? 1 : 0,
          $starred: fields.starred ? 1 : 0,
          $rev: rev,
          $now: now,
        });
        return true;
      }
      case "update": {
        const { op: _op, id: _id, ...fields } = op;
        return applyFields(row!, fields, rev, now);
      }
      case "move":
        if (row!.parent_id === op.parentId && row!.rank === op.rank) return false;
        moveNode.run(op.parentId, op.rank, rev, now, op.id);
        return true;
      case "delete":
        if (row!.deleted_at !== null) return false;
        setDeleted.run(now, rev, now, op.id);
        return true;
      case "restore":
        if (row!.deleted_at === null) return false;
        setDeleted.run(null, rev, now, op.id);
        touchDescendants.run({ $id: op.id, $rev: rev });
        return true;
    }
  }

  /** Writes the fields that differ from the row. Returns whether there were any. */
  function applyFields(row: Row, fields: Partial<NodeFields>, rev: number, now: string): boolean {
    const current = toNode(row);
    const changed: Partial<NodeFields> = {};
    let any = false;
    for (const f of FIELD_NAMES) {
      if (fields[f] !== undefined && fields[f] !== current[f]) {
        (changed as Record<string, unknown>)[f] = fields[f];
        any = true;
      }
    }
    if (any) updateFields(row.id, changed, rev, now);
    return any;
  }

  return {
    /** The latest revision of the whole database. */
    currentRev: () => meta("rev"),

    /** Every node `owner` can see (none deleted, none under a deleted one). */
    load(owner: string): TreeResponse {
      return { rev: meta("rev"), nodes: (selectLive.all({ $owner: owner }) as unknown as Row[]).map(toNode) };
    },

    /** The nodes of `owner` changed after revision `since`, deleted ones included. */
    changesSince(owner: string, since: number): ChangesResponse {
      if (since < meta("purged_rev")) return { reset: true };
      return { rev: meta("rev"), nodes: (selectChanged.all(owner, since) as unknown as Row[]).map(toNode) };
    },

    /**
     * Applies a batch from the network in one transaction, as one new revision. Each op is
     * checked on its own; the refused ones are listed and the rest still apply.
     */
    applyOps(owner: string, ops: unknown): OpsResponse {
      if (!Array.isArray(ops)) throw new BatchError("ops must be an array");
      if (ops.length > LIMITS.opsPerBatch) throw new BatchError(`At most ${LIMITS.opsPerBatch} ops per request`);
      return transaction(() => {
        const rev = meta("rev") + 1;
        const now = new Date().toISOString();
        const rejected: OpsResponse["rejected"] = [];
        let changed = false;
        ops.forEach((raw, index) => {
          const op = parseOp(raw);
          const result = typeof op === "string" ? op : applyOp(owner, op, rev, now);
          if (typeof result === "string") rejected.push({ index, reason: result });
          else changed ||= result;
        });
        if (changed) setMeta.run(rev, "rev");
        return { rev: changed ? rev : null, rejected };
      });
    },

    /**
     * Deletes for good the bullets deleted more than PURGE_AFTER_DAYS ago, with everything
     * under them. Browsers that synced before then must reload. Returns how many were deleted.
     */
    purge(now = new Date()): number {
      const cutoff = new Date(now.getTime() - PURGE_AFTER_DAYS * 86_400_000).toISOString();
      return transaction(() => {
        const { changes } = purgeDeleted.run(cutoff);
        if (changes > 0) {
          const rev = meta("rev") + 1;
          setMeta.run(rev, "rev");
          setMeta.run(rev, "purged_rev");
        }
        return Number(changes);
      });
    },

    /**
     * Deletes for good the bullets of every owner who isn't in `known` (Heimdall's usernames),
     * i.e. of users removed from Heimdall. Returns how many bullets each of them had. No
     * revision is needed: nobody left can see those bullets.
     */
    removeUnknownOwners(known: ReadonlySet<string>): { owner: string; rows: number }[] {
      const $known = JSON.stringify([...known]);
      return transaction(() => {
        const removed = countUnknownOwners.all({ $known }) as { owner: string; rows: number }[];
        deleteUnknownOwners.run({ $known });
        return removed;
      });
    },
  };
}

export type Tree = ReturnType<typeof createTree>;
