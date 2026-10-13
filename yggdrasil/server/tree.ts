// Every read and write of nodes goes through here, so this is the one place that decides who
// may see or change a node: its owner, and the people a bullet above it is shared with.
//
// A bullet always belongs to its parent's owner: bullets added inside a shared bullet by someone
// it is shared with are the owner's, and nothing moves between two people's trees.
import type { DatabaseSync } from "node:sqlite";
import {
  FIELD_NAMES,
  LIMITS,
  fileIdsIn,
  parseOp,
  type ChangesResponse,
  type Node,
  type NodeFields,
  type Op,
  type OpsResponse,
  type Permission,
  type Role,
  type Share,
  type Shares,
  type SharedWithMe,
  type TreeResponse,
} from "../shared/protocol.ts";

/** A problem with a whole batch rather than one op. Answered with 400. */
export class BatchError extends Error {}

/** A request about sharing that is refused, with the HTTP status to answer. */
export class AccessError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Deleted bullets are kept this long, then purged for good. So are uploaded files that no
 * bullet's text refers to any more, so undoing or redoing an insert keeps working that long.
 */
export const PURGE_AFTER_DAYS = 30;

/** An uploaded file, as the database knows it (the bytes are on disk; see files.ts). */
export interface FileRow {
  id: string;
  owner: string;
  uploader: string;
  name: string;
  type: string;
  size: number;
  has_preview: number;
}

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

/** Someone's own collapsed and starred for a bullet shared with them. */
interface ViewRow {
  collapsed: number | null;
  starred: number;
}

interface ShareRow {
  node_id: string;
  owner: string;
  username: string;
  permission: Permission;
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

/** The fields that are each person's own on a bullet shared with them. */
const VIEW_FIELDS = ["collapsed", "starred"] as const;

// A walk up the parents never needs more steps than this; more means the data is broken.
const MAX_DEPTH = 100_000;

const READ_ONLY = "shared with you to read only";
const NOT_YOURS_TO_MOVE = "only its owner can move or delete this bullet";
const OTHER_TREE = "a bullet can't move between two people's outlines";

const better = (a: Permission | null, b: Permission | null): Permission | null =>
  a === "write" || b === "write" ? "write" : (a ?? b);

/** How a node is seen from the bullets shared with someone. */
interface Seen {
  /** The best permission of the shared bullets it is in, or null if it is in none. */
  best: Permission | null;
  /** Neither the node nor anything above it is deleted. */
  alive: boolean;
}

export function createTree(db: DatabaseSync) {
  const COLUMNS = "id, owner, parent_id, rank, content, note, completed_at, collapsed, starred, deleted_at";

  const getMeta = db.prepare("SELECT value FROM meta WHERE key = ?");
  const setMeta = db.prepare("UPDATE meta SET value = ? WHERE key = ?");
  const selectNode = db.prepare(`SELECT ${COLUMNS} FROM nodes WHERE id = ?`);
  const selectParent = db.prepare("SELECT parent_id FROM nodes WHERE id = ?");
  const selectUp = db.prepare("SELECT parent_id, deleted_at FROM nodes WHERE id = ?");
  // The nodes the user can see: from the top-level ones down, never through a deleted one.
  const selectLive = db.prepare(`
    WITH RECURSIVE live(id) AS (
      SELECT id FROM nodes WHERE owner = $owner AND parent_id IS NULL AND deleted_at IS NULL
      UNION ALL
      SELECT n.id FROM nodes n JOIN live ON n.parent_id = live.id WHERE n.deleted_at IS NULL
    )
    SELECT ${COLUMNS} FROM nodes JOIN live USING (id)`);
  // A shared bullet and everything under it, never through a deleted one.
  const selectLiveSubtree = db.prepare(`
    WITH RECURSIVE live(id) AS (
      SELECT id FROM nodes WHERE id = $id AND deleted_at IS NULL
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

  // Files
  const FILE_COLUMNS = "id, owner, uploader, name, type, size, has_preview";
  const selectFile = db.prepare(`SELECT ${FILE_COLUMNS} FROM files WHERE id = ?`);
  const insertFile = db.prepare(`
    INSERT INTO files (id, owner, uploader, name, type, size, created_at)
    VALUES ($id, $owner, $uploader, $name, $type, $size, $now)`);
  const setHasPreview = db.prepare("UPDATE files SET has_preview = 1 WHERE id = ?");
  const selectNodeRefs = db.prepare("SELECT file_id FROM file_refs WHERE node_id = ?");
  const selectFileRefs = db.prepare("SELECT node_id FROM file_refs WHERE file_id = ?");
  const insertRef = db.prepare("INSERT OR IGNORE INTO file_refs (file_id, node_id) VALUES (?, ?)");
  const deleteRef = db.prepare("DELETE FROM file_refs WHERE file_id = ? AND node_id = ?");
  const setUnref = db.prepare(`
    UPDATE files SET unref_at = $now
    WHERE id = $id AND NOT EXISTS (SELECT 1 FROM file_refs WHERE file_id = $id)`);
  const clearUnref = db.prepare("UPDATE files SET unref_at = NULL WHERE id = ?");
  // When a deleted bullet is purged, its references go with it (ON DELETE CASCADE) and its files
  // count from when they were uploaded, which by then is long enough ago.
  const selectUnusedFiles = db.prepare(`
    SELECT id FROM files f
    WHERE NOT EXISTS (SELECT 1 FROM file_refs r WHERE r.file_id = f.id)
      AND COALESCE(unref_at, created_at) < ?`);
  const deleteFile = db.prepare("DELETE FROM files WHERE id = ?");
  const selectFileIds = db.prepare("SELECT id FROM files");

  // Sharing
  const SHARE_COLUMNS = "s.node_id, n.owner, s.username, s.permission FROM shares s JOIN nodes n ON n.id = s.node_id";
  const selectSharesWith = db.prepare(`SELECT ${SHARE_COLUMNS} WHERE s.username = ? ORDER BY n.owner, s.node_id`);
  const selectSharesBy = db.prepare(`SELECT ${SHARE_COLUMNS} WHERE n.owner = ? ORDER BY s.node_id, s.username`);
  const selectNodeShares = db.prepare("SELECT username, permission FROM shares WHERE node_id = ? ORDER BY username");
  const insertShare = db.prepare("INSERT INTO shares (node_id, username, permission) VALUES (?, ?, ?)");
  const updateShare = db.prepare("UPDATE shares SET permission = ? WHERE node_id = ? AND username = ?");
  const deleteShare = db.prepare("DELETE FROM shares WHERE node_id = ? AND username = ?");
  const selectView = db.prepare("SELECT collapsed, starred FROM node_views WHERE node_id = ? AND username = ?");
  const selectViews = db.prepare("SELECT node_id, collapsed, starred FROM node_views WHERE username = ?");
  const selectViewsSince = db.prepare("SELECT node_id FROM node_views WHERE username = ? AND rev > ?");
  const upsertView = db.prepare(`
    INSERT INTO node_views (node_id, username, collapsed, starred, rev) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (node_id, username) DO UPDATE SET collapsed = excluded.collapsed, starred = excluded.starred, rev = excluded.rev`);
  const selectReset = db.prepare("SELECT rev FROM resets WHERE username = ?");
  const upsertReset = db.prepare(
    "INSERT INTO resets (username, rev) VALUES (?, ?) ON CONFLICT (username) DO UPDATE SET rev = excluded.rev",
  );

  // $known: a JSON array of usernames.
  const UNKNOWN_OWNER = "owner NOT IN (SELECT value FROM json_each($known))";
  const UNKNOWN_USER = "username NOT IN (SELECT value FROM json_each($known))";
  const countUnknownOwners = db.prepare(
    `SELECT owner, count(*) AS rows FROM nodes WHERE ${UNKNOWN_OWNER} GROUP BY owner ORDER BY owner`,
  );
  // Nodes take their shares and views with them; then nothing stays shared with those users.
  const deleteUnknown = [
    db.prepare(`DELETE FROM nodes WHERE ${UNKNOWN_OWNER}`),
    db.prepare(`DELETE FROM files WHERE ${UNKNOWN_OWNER}`),
    ...["shares", "node_views", "resets"].map((table) => db.prepare(`DELETE FROM ${table} WHERE ${UNKNOWN_USER}`)),
  ];
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

  /**
   * Records which files a node's text refers to. Only files of the node's own tree count, so
   * writing someone else's file address into a bullet shows nobody that file.
   */
  function syncRefs(id: string, owner: string, content: string, note: string, now: string): void {
    const before = new Set((selectNodeRefs.all(id) as { file_id: string }[]).map((r) => r.file_id));
    const after = new Set(
      fileIdsIn(`${content}\n${note}`).filter((f) => (selectFile.get(f) as FileRow | undefined)?.owner === owner),
    );
    for (const f of before) {
      if (after.has(f)) continue;
      deleteRef.run(f, id);
      setUnref.run({ $id: f, $now: now });
    }
    for (const f of after) {
      if (before.has(f)) continue;
      insertRef.run(f, id);
      clearUnref.run(f);
    }
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

  /** The ids from `id` up to the top. */
  function chain(id: string | null): Set<string> {
    const ids = new Set<string>();
    for (let cur = id; cur !== null;) {
      if (ids.size > MAX_DEPTH) throw new Error(`Parent chain of ${id} is too deep or has a cycle`);
      ids.add(cur);
      cur = (selectParent.get(cur) as { parent_id: string | null } | undefined)?.parent_id ?? null;
    }
    return ids;
  }

  /** The bullets shared with `user`, by id. */
  function grantedTo(user: string): Map<string, ShareRow> {
    return new Map((selectSharesWith.all(user) as unknown as ShareRow[]).map((s) => [s.node_id, s]));
  }

  /**
   * How nodes are seen from the bullets shared with someone (`granted`). A shared bullet counts
   * while neither it nor anything above it is deleted; under it, deleted bullets are still in it,
   * so they can be restored. Answers are remembered in `memo` (drop it after the tree changes).
   */
  function seer(granted: ReadonlyMap<string, ShareRow>, memo = new Map<string, Seen>()) {
    const top: Seen = { best: null, alive: true };
    const seen = (id: string | null): Seen => {
      if (id === null) return top;
      const known = memo.get(id);
      if (known) return known;
      // Walk up to something remembered (or the top), then come back down.
      const path: { id: string; deleted: boolean }[] = [];
      let above: Seen = top;
      for (let cur: string | null = id; cur !== null;) {
        const hit = memo.get(cur);
        if (hit) {
          above = hit;
          break;
        }
        if (path.length > MAX_DEPTH) throw new Error(`Parent chain of ${id} is too deep or has a cycle`);
        const row = selectUp.get(cur) as { parent_id: string | null; deleted_at: string | null } | undefined;
        if (!row) break;
        path.push({ id: cur, deleted: row.deleted_at !== null });
        cur = row.parent_id;
      }
      for (let i = path.length - 1; i >= 0; i--) {
        const { id: at, deleted } = path[i]!;
        const alive = above.alive && !deleted;
        const share = granted.get(at);
        above = { best: alive && share ? better(above.best, share.permission) : above.best, alive };
        memo.set(at, above);
      }
      return above;
    };
    return {
      seen,
      /** Whether a node is in a bullet shared with them. */
      visible: (id: string) => seen(id).best !== null,
      /** Whether a node is a shared bullet that isn't inside another one shared with them. */
      isTop: (row: Pick<Row, "id" | "parent_id">) =>
        seen(row.id).best !== null && granted.has(row.id) && seen(row.parent_id).best === null,
    };
  }

  /** `user`'s role on a node, or null if they can't see it. `memo` as for seer. */
  function roleOf(
    user: string,
    row: Pick<Row, "id" | "owner">,
    granted: ReadonlyMap<string, ShareRow>,
    memo?: Map<string, Seen>,
  ): Role | null {
    if (row.owner === user) return "owner";
    if (granted.size === 0) return null;
    const best = seer(granted, memo).seen(row.id).best;
    return best === "write" ? "editor" : best === "read" ? "viewer" : null;
  }

  /**
   * `user`'s role on a place in the tree: under `parentId`, in the tree of `owner`. The top level
   * of a tree is its owner's alone.
   */
  function placeRole(
    user: string,
    parentId: string | null,
    owner: string,
    granted: ReadonlyMap<string, ShareRow>,
    memo?: Map<string, Seen>,
  ): Role | null {
    if (parentId === null) return owner === user ? "owner" : null;
    const parent = selectNode.get(parentId) as Row | undefined;
    if (!parent || parent.owner !== owner) return null;
    return roleOf(user, parent, granted, memo);
  }

  const canWrite = (role: Role | null) => role === "owner" || role === "editor";

  /** Someone's own collapsed and starred over the owner's, for a bullet shared with them. */
  function withView(node: Node, view: ViewRow | undefined): Node {
    return {
      ...node,
      collapsed: view?.collapsed == null ? node.collapsed : view.collapsed === 1,
      starred: view?.starred === 1,
    };
  }

  /** The node as `user` sees it: their own view of a shared bullet, which comes without its parent. */
  function present(user: string, row: Row, top: boolean, view?: ViewRow): Node {
    const node = toNode(row);
    if (row.owner === user) return node;
    return {
      ...withView(node, view ?? (selectView.get(row.id, user) as ViewRow | undefined)),
      ...(top && { parentId: null }),
    };
  }

  /** Writes `user`'s own collapsed and starred for a shared bullet. Returns whether they changed. */
  function applyView(user: string, row: Row, fields: Partial<NodeFields>, rev: number): boolean {
    if (fields.collapsed === undefined && fields.starred === undefined) return false;
    const view = selectView.get(row.id, user) as ViewRow | undefined;
    const before = withView(toNode(row), view);
    const collapsed = fields.collapsed ?? before.collapsed;
    const starred = fields.starred ?? before.starred;
    if (collapsed === before.collapsed && starred === before.starred) return false;
    // Collapsed stays the owner's until this person changes it.
    const ownCollapsed =
      fields.collapsed !== undefined ? (collapsed ? 1 : 0) : view?.collapsed === undefined ? null : view.collapsed;
    upsertView.run(row.id, user, ownCollapsed, starred ? 1 : 0, rev);
    return true;
  }

  /** The bullets `user` shares and those shared with them (only those they can reach). */
  function sharesOf(user: string, granted = grantedTo(user)): Shares {
    const byMe = new Map<string, Share[]>();
    for (const s of selectSharesBy.all(user) as unknown as ShareRow[]) {
      const list = byMe.get(s.node_id) ?? [];
      list.push({ username: s.username, permission: s.permission });
      byMe.set(s.node_id, list);
    }
    const { seen } = seer(granted);
    const withMe: SharedWithMe[] = [...granted.values()]
      .filter((s) => seen(s.node_id).alive)
      .map((s) => ({ id: s.node_id, owner: s.owner, permission: s.permission }));
    return { byMe: [...byMe].map(([id, shares]) => ({ id, shares })), withMe };
  }

  /** Everyone who sees part of `owner`'s tree: them, and the people they share bullets with. */
  function audienceOf(owner: string): string[] {
    return [owner, ...(selectSharesBy.all(owner) as unknown as ShareRow[]).map((s) => s.username)];
  }

  /** The people a bullet at or above `id` in `owner`'s tree is shared with. */
  function recipientsAt(ownerShares: readonly ShareRow[], id: string | null): Set<string> {
    const out = new Set<string>();
    if (ownerShares.length === 0 || id === null) return out;
    const above = chain(id);
    for (const s of ownerShares) if (above.has(s.node_id)) out.add(s.username);
    return out;
  }

  /** What a batch does besides changing nodes: whose pages to tell, whose to reload. */
  interface BatchState {
    granted: ReadonlyMap<string, ShareRow>;
    /** How nodes are seen (see seer), until a move, delete or restore changes it. */
    memo: Map<string, Seen>;
    /** Owners of the nodes changed. */
    owners: Set<string>;
    /** People whose pages must load the whole tree again. */
    resets: Set<string>;
    sharesBy: (owner: string) => ShareRow[];
  }

  /**
   * Applies one op as `user` at revision `rev`. Returns why it was refused, or whether it
   * changed anything: ops that would leave a node as it is write nothing, so a batch sent
   * twice changes nothing the second time.
   */
  function applyOp(user: string, op: Op, rev: number, now: string, batch: BatchState): string | boolean {
    const { granted, memo } = batch;
    const row = selectNode.get(op.id) as Row | undefined;
    const role = row ? roleOf(user, row, granted, memo) : null;
    // The create was sent before and saved. The node may have changed since, so it stays as it is.
    if (row && op.op === "create") return role ? false : "id already in use";
    if (op.op !== "create" && (!row || !role)) return "unknown node";

    switch (op.op) {
      case "create": {
        let owner = user;
        if (op.parentId !== null) {
          const parent = selectNode.get(op.parentId) as Row | undefined;
          const parentRole = parent ? roleOf(user, parent, granted, memo) : null;
          if (!parent || !parentRole) return "unknown parent";
          if (!canWrite(parentRole)) return READ_ONLY;
          owner = parent.owner;
        }
        const { op: _op, id, parentId, rank, ...fields } = op;
        const own = owner === user;
        insertNode.run({
          $id: id,
          $owner: owner,
          $parent: parentId,
          $rank: rank,
          $content: fields.content ?? "",
          $note: fields.note ?? "",
          $completed: fields.completedAt ?? null,
          $collapsed: own && fields.collapsed ? 1 : 0,
          $starred: own && fields.starred ? 1 : 0,
          $rev: rev,
          $now: now,
        });
        if (fields.content || fields.note) syncRefs(id, owner, fields.content ?? "", fields.note ?? "", now);
        if (!own) applyView(user, selectNode.get(id) as unknown as Row, fields, rev);
        batch.owners.add(owner);
        return true;
      }
      case "update": {
        const { op: _op, id: _id, ...fields } = op;
        const nodeFields: Partial<NodeFields> = { ...fields };
        const viewFields: Partial<NodeFields> = {};
        if (role !== "owner") {
          for (const f of VIEW_FIELDS) {
            if (fields[f] !== undefined) (viewFields as Record<string, unknown>)[f] = fields[f];
            delete nodeFields[f];
          }
          if (role === "viewer" && FIELD_NAMES.some((f) => nodeFields[f] !== undefined)) return READ_ONLY;
        }
        const changedNode = applyFields(row!, nodeFields, rev, now);
        if (changedNode) batch.owners.add(row!.owner);
        const changedView = applyView(user, row!, viewFields, rev);
        return changedNode || changedView;
      }
      case "move": {
        if (row!.parent_id === op.parentId && row!.rank === op.rank) return false;
        if (role === "viewer") return READ_ONLY;
        if (!canWrite(placeRole(user, row!.parent_id, row!.owner, granted, memo))) return NOT_YOURS_TO_MOVE;
        if (op.parentId !== null) {
          const parent = selectNode.get(op.parentId) as Row | undefined;
          if (!parent || !roleOf(user, parent, granted, memo)) return "unknown parent";
          if (parent.owner !== row!.owner) return OTHER_TREE;
          if (isAncestorOrSelf(op.id, op.parentId)) return "would put a bullet inside itself";
        }
        const placeRoleThere = placeRole(user, op.parentId, row!.owner, granted, memo);
        if (op.parentId === null && !placeRoleThere) return OTHER_TREE;
        if (!canWrite(placeRoleThere)) return READ_ONLY;
        // Moving into or out of a shared bullet changes who sees it, and what is under it.
        const shares = batch.sharesBy(row!.owner);
        const before = recipientsAt(shares, row!.parent_id);
        const after = recipientsAt(shares, op.parentId);
        for (const u of before) if (!after.has(u)) batch.resets.add(u);
        for (const u of after) if (!before.has(u)) batch.resets.add(u);
        moveNode.run(op.parentId, op.rank, rev, now, op.id);
        memo.clear();
        batch.owners.add(row!.owner);
        return true;
      }
      case "delete":
      case "restore": {
        if ((row!.deleted_at !== null) === (op.op === "delete")) return false;
        if (role === "viewer") return READ_ONLY;
        if (!canWrite(placeRole(user, row!.parent_id, row!.owner, granted, memo))) return NOT_YOURS_TO_MOVE;
        // Whoever a bullet at or under it is shared with loses it, or gets it back, as a whole.
        for (const s of batch.sharesBy(row!.owner))
          if (isAncestorOrSelf(op.id, s.node_id)) batch.resets.add(s.username);
        setDeleted.run(op.op === "delete" ? now : null, rev, now, op.id);
        if (op.op === "restore") touchDescendants.run({ $id: op.id, $rev: rev });
        memo.clear();
        batch.owners.add(row!.owner);
        return true;
      }
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
    if (changed.content !== undefined || changed.note !== undefined) {
      syncRefs(row.id, row.owner, changed.content ?? row.content, changed.note ?? row.note, now);
    }
    return any;
  }

  /** Starts a new revision in which `users` must load the whole tree again. Inside a transaction. */
  function newRev(resets: Iterable<string> = []): number {
    const rev = meta("rev") + 1;
    setMeta.run(rev, "rev");
    for (const u of resets) upsertReset.run(u, rev);
    return rev;
  }

  /** A node of `user`'s own, not deleted (nor anything above it). */
  function ownLiveNode(user: string, id: string, refusal: string): Row {
    const row = selectNode.get(id) as Row | undefined;
    if (!row || !roleOf(user, row, grantedTo(user))) throw new AccessError(404, "No such bullet");
    if (row.owner !== user) throw new AccessError(403, refusal);
    if (!seer(new Map()).seen(id).alive) throw new AccessError(404, "No such bullet");
    return row;
  }

  const shareList = (id: string) => selectNodeShares.all(id) as unknown as Share[];

  return {
    /** The latest revision of the whole database. */
    currentRev: () => meta("rev"),

    /**
     * Every node `user` can see: their own tree (none deleted, none under a deleted one), and the
     * bullets shared with them with everything under them, in their own view.
     */
    load(user: string): TreeResponse {
      const granted = grantedTo(user);
      const nodes = (selectLive.all({ $owner: user }) as unknown as Row[]).map(toNode);
      const shares = sharesOf(user, granted);
      if (granted.size > 0) {
        const views = new Map(
          (selectViews.all(user) as unknown as (ViewRow & { node_id: string })[]).map((v) => [v.node_id, v]),
        );
        const { isTop } = seer(granted);
        const seen = new Set<string>();
        for (const { id } of shares.withMe) {
          if (seen.has(id)) continue; // inside another bullet shared with them
          for (const row of selectLiveSubtree.all({ $id: id }) as unknown as Row[]) {
            if (seen.has(row.id)) continue;
            seen.add(row.id);
            nodes.push(present(user, row, row.id === id && isTop(row), views.get(row.id)));
          }
        }
      }
      return { rev: meta("rev"), nodes, shares };
    },

    /**
     * The nodes `user` can see that changed after revision `since`, deleted ones included: their
     * own, those in bullets shared with them, and those whose view (collapsed, starred) they
     * changed. A reset when what they may see changed in a way the list can't say.
     */
    changesSince(user: string, since: number): ChangesResponse {
      const reset = (selectReset.get(user) as { rev: number } | undefined)?.rev ?? 0;
      if (since < meta("purged_rev") || since < reset) return { reset: true };
      const rev = meta("rev");
      const nodes = (selectChanged.all(user, since) as unknown as Row[]).map(toNode);
      const granted = grantedTo(user);
      if (granted.size > 0) {
        const { visible, isTop } = seer(granted);
        const rows = new Map<string, Row>();
        for (const owner of new Set([...granted.values()].map((s) => s.owner))) {
          for (const row of selectChanged.all(owner, since) as unknown as Row[]) rows.set(row.id, row);
        }
        for (const { node_id } of selectViewsSince.all(user, since) as unknown as { node_id: string }[]) {
          if (!rows.has(node_id)) {
            const row = selectNode.get(node_id) as Row | undefined;
            if (row) rows.set(node_id, row);
          }
        }
        for (const row of rows.values()) if (visible(row.id)) nodes.push(present(user, row, isTop(row)));
      }
      return { rev, nodes, shares: sharesOf(user, granted) };
    },

    /**
     * Applies a batch from the network in one transaction, as one new revision. Each op is
     * checked on its own; the refused ones are listed and the rest still apply. `notify`, if
     * given, collects whose pages should hear about it.
     */
    applyOps(user: string, ops: unknown, notify?: Set<string>): OpsResponse {
      if (!Array.isArray(ops)) throw new BatchError("ops must be an array");
      if (ops.length > LIMITS.opsPerBatch) throw new BatchError(`At most ${LIMITS.opsPerBatch} ops per request`);
      return transaction(() => {
        const rev = meta("rev") + 1;
        const now = new Date().toISOString();
        const rejected: OpsResponse["rejected"] = [];
        const sharesByOwner = new Map<string, ShareRow[]>();
        const batch: BatchState = {
          granted: grantedTo(user),
          memo: new Map(),
          owners: new Set(),
          resets: new Set(),
          sharesBy: (owner) => {
            let list = sharesByOwner.get(owner);
            if (!list) sharesByOwner.set(owner, (list = selectSharesBy.all(owner) as unknown as ShareRow[]));
            return list;
          },
        };
        let changed = false;
        ops.forEach((raw, index) => {
          const op = parseOp(raw);
          const result = typeof op === "string" ? op : applyOp(user, op, rev, now, batch);
          if (typeof result === "string") rejected.push({ index, reason: result });
          else changed ||= result;
        });
        if (changed) {
          newRev(batch.resets);
          notify?.add(user);
          for (const owner of batch.owners) for (const u of audienceOf(owner)) notify?.add(u);
          for (const u of batch.resets) notify?.add(u);
        }
        return { rev: changed ? rev : null, rejected };
      });
    },

    // ── Sharing ───────────────────────────────────────────────────────────────────────────────

    /** Who a bullet of `user`'s own is shared with. */
    shares(user: string, id: string): Share[] {
      ownLiveNode(user, id, "Only its owner can see who a bullet is shared with");
      return shareList(id);
    },

    /**
     * Replaces everyone a bullet (and everything under it) is shared with: `[{ username,
     * permission }]`. Only its owner can; `known` are the usernames it can be shared with
     * (Heimdall's). `notify` collects whose pages should hear about it.
     */
    setShares(
      user: string,
      id: string,
      input: unknown,
      known: ReadonlySet<string> | null,
      notify: Set<string> = new Set(),
    ): Share[] {
      if (!known) throw new AccessError(400, "Yggdrasil doesn't know the suite's users, so it can't share bullets");
      if (!Array.isArray(input)) throw new AccessError(400, "Expected a list of { username, permission }");
      const next = new Map<string, Permission>();
      for (const item of input as unknown[]) {
        const { username, permission } = (item ?? {}) as Partial<Record<keyof Share, unknown>>;
        if (typeof username !== "string" || !known.has(username))
          throw new AccessError(400, `Not a user: ${String(username)}`);
        if (username === user) throw new AccessError(400, "A bullet can't be shared with its owner");
        if (next.has(username)) throw new AccessError(400, `Listed twice: ${username}`);
        if (permission !== "read" && permission !== "write")
          throw new AccessError(400, "permission must be 'read' or 'write'");
        next.set(username, permission);
      }
      return transaction(() => {
        ownLiveNode(user, id, "Only its owner can share this bullet");
        const before = new Map(shareList(id).map((s) => [s.username, s.permission]));
        const resets = new Set<string>();
        let changed = false;
        for (const username of before.keys()) {
          if (next.has(username)) continue;
          deleteShare.run(id, username);
          resets.add(username);
        }
        for (const [username, permission] of next) {
          if (!before.has(username)) {
            insertShare.run(id, username, permission);
            resets.add(username);
          } else if (before.get(username) !== permission) {
            updateShare.run(permission, id, username);
            changed = true;
          }
        }
        if (changed || resets.size > 0) {
          newRev(resets);
          for (const u of [user, ...before.keys(), ...next.keys()]) notify.add(u);
        }
        return shareList(id);
      });
    },

    /**
     * Stops sharing a bullet with one person. Its owner can remove anyone; anyone can remove
     * themselves ("Remove from my list").
     */
    removeShare(user: string, id: string, username: string, notify: Set<string> = new Set()): void {
      transaction(() => {
        const row = selectNode.get(id) as Row | undefined;
        if (!row || !roleOf(user, row, grantedTo(user))) throw new AccessError(404, "No such bullet");
        if (row.owner !== user && username !== user)
          throw new AccessError(403, "Only its owner can change who sees this bullet");
        if (Number(deleteShare.run(id, username).changes) === 0)
          throw new AccessError(404, "The bullet isn't shared with them");
        newRev([username]);
        for (const u of [user, row.owner, username]) notify.add(u);
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

    // ── Files ─────────────────────────────────────────────────────────────────────────────────

    /**
     * Whose tree a file that `user` uploads into bullet `nodeId` belongs to: the bullet's owner,
     * as bullets added there do. Refused unless `user` may change that bullet.
     */
    uploadOwner(user: string, nodeId: string): string {
      const row = selectNode.get(nodeId) as Row | undefined;
      const role = row ? roleOf(user, row, grantedTo(user)) : null;
      if (!row || !role || !seer(new Map()).seen(nodeId).alive) throw new AccessError(404, "No such bullet");
      if (!canWrite(role)) throw new AccessError(403, "This bullet is shared with you to read only");
      return row.owner;
    },

    /** Records a file whose bytes are saved. */
    addFile(file: Omit<FileRow, "has_preview">): void {
      insertFile.run({
        $id: file.id,
        $owner: file.owner,
        $uploader: file.uploader,
        $name: file.name,
        $type: file.type,
        $size: file.size,
        $now: new Date().toISOString(),
      });
    },

    /**
     * A file `user` may download, or null (no such file, or not theirs to see). They may if it
     * is in their tree, if they uploaded it, or if they can see a bullet whose text refers to it.
     */
    fileFor(user: string, id: string): FileRow | null {
      const file = selectFile.get(id) as FileRow | undefined;
      if (!file) return null;
      if (file.owner === user || file.uploader === user) return file;
      const granted = grantedTo(user);
      if (granted.size === 0) return null;
      const { seen } = seer(granted);
      for (const { node_id } of selectFileRefs.all(id) as { node_id: string }[]) {
        const s = seen(node_id);
        if (s.best !== null && s.alive) return file;
      }
      return null;
    },

    /** The file `user` may give a preview: one they uploaded (or in their tree) that has none yet. */
    previewTarget(user: string, id: string): FileRow {
      const file = selectFile.get(id) as FileRow | undefined;
      if (!file || (file.uploader !== user && file.owner !== user)) throw new AccessError(404, "No such file");
      if (file.has_preview) throw new AccessError(409, "This file has a preview already");
      return file;
    },

    /** Records that a file's preview is saved. */
    setPreview(id: string): void {
      setHasPreview.run(id);
    },

    /**
     * Deletes for good the files no bullet has referred to for PURGE_AFTER_DAYS (or ever, if they
     * were uploaded that long ago). Returns their ids, so their bytes can be deleted too.
     */
    purgeFiles(now = new Date()): string[] {
      const cutoff = new Date(now.getTime() - PURGE_AFTER_DAYS * 86_400_000).toISOString();
      return transaction(() => {
        const ids = (selectUnusedFiles.all(cutoff) as { id: string }[]).map((r) => r.id);
        for (const id of ids) deleteFile.run(id);
        return ids;
      });
    },

    /** The id of every file there is. */
    fileIds(): Set<string> {
      return new Set((selectFileIds.all() as { id: string }[]).map((r) => r.id));
    },

    /**
     * Deletes for good the bullets of every owner who isn't in `known` (Heimdall's usernames),
     * i.e. of users removed from Heimdall, and their files, and stops sharing bullets with them. Returns how many
     * bullets each of them had. No revision is needed: nobody left can see those bullets, and
     * nobody left sees what was shared with them.
     */
    removeUnknownOwners(known: ReadonlySet<string>): { owner: string; rows: number }[] {
      const $known = JSON.stringify([...known]);
      return transaction(() => {
        const removed = countUnknownOwners.all({ $known }) as { owner: string; rows: number }[];
        for (const stmt of deleteUnknown) stmt.run({ $known });
        return removed;
      });
    },
  };
}

export type Tree = ReturnType<typeof createTree>;
