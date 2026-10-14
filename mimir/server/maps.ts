// The maps of each user: the sidebar's list, loading a map, catching up on changes, backups, and
// the clean-up of deleted nodes and removed users. Every query names the owner (a Heimdall
// username) or a map already checked to be theirs, so nobody reaches another user's maps; a map
// that belongs to someone else answers exactly like one that doesn't exist.
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  LIMITS,
  PURGE_AFTER_DAYS,
  SIDES,
  compareSiblings,
  labelError,
  mapName,
  textError,
  type ChangesResponse,
  type ExportArrow,
  type ExportFile,
  type ExportMap,
  type ExportNode,
  type MapData,
  type MapSummary,
  type OpsResponse,
  type RestoreResult,
  type Side,
} from "../shared/protocol.ts";
import { StoreError, invalid, notFound, objectBody, tooMany, transaction } from "./errors.ts";
import { ARROW_COLUMNS, NODE_COLUMNS, createOps, toArrow, toNode, type ArrowRow, type NodeRow } from "./ops.ts";
import { freshRanks, rankAfter, rankAtEnd, type Ranked } from "./ranks.ts";

interface MapRow {
  id: string;
  rank: string;
  rev: number;
  purged_rev: number;
  updated_at: string;
  text: string;
}

/** A map from a backup, checked: its nodes in pre-order, each with its parent's number. */
interface ImportMap {
  nodes: { text: string; side: Side | null; collapsed: boolean; parent: number }[];
  arrows: { from: number; to: number; label: string }[];
  droppedArrows: number;
}

/** The rank the server gives a map's root. It has no siblings, so any key will do. */
const ROOT_RANK = "a0";

export function createMaps(db: DatabaseSync) {
  const ops = createOps(db);

  const MAP = `SELECT m.id, m.rank, m.rev, m.purged_rev, m.updated_at, r.text
    FROM maps m JOIN nodes r ON r.map_id = m.id AND r.parent_id IS NULL`;
  const selectMaps = db.prepare(`${MAP} WHERE m.owner = ? ORDER BY m.rank, m.id`);
  const selectMap = db.prepare(`${MAP} WHERE m.owner = ? AND m.id = ?`);
  const insertMap = db.prepare(
    "INSERT INTO maps (id, owner, rank, rev, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)",
  );
  const setMapRank = db.prepare("UPDATE maps SET rank = ? WHERE id = ?");
  const deleteMapRow = db.prepare("DELETE FROM maps WHERE id = ? AND owner = ?");
  const countMaps = db.prepare("SELECT count(*) AS n FROM maps WHERE owner = ?");
  const countUserNodes = db.prepare(
    "SELECT count(*) AS n FROM nodes WHERE map_id IN (SELECT id FROM maps WHERE owner = ?)",
  );

  const insertNode = db.prepare(`
    INSERT INTO nodes (id, map_id, parent_id, rank, side, text, collapsed, rev, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`);
  const insertArrow = db.prepare(`
    INSERT INTO arrows (id, map_id, from_id, to_id, label, rev, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?)`);
  // The root and every node not inside a deleted branch.
  const selectLive = db.prepare(`
    WITH RECURSIVE live(id) AS (
      SELECT id FROM nodes WHERE map_id = $map AND parent_id IS NULL
      UNION ALL
      SELECT n.id FROM nodes n JOIN live ON n.parent_id = live.id WHERE n.deleted_at IS NULL
    )
    SELECT ${NODE_COLUMNS} FROM nodes JOIN live USING (id)`);
  const selectArrows = db.prepare(`SELECT ${ARROW_COLUMNS} FROM arrows WHERE map_id = ? AND deleted_at IS NULL`);
  const selectChangedNodes = db.prepare(`SELECT ${NODE_COLUMNS} FROM nodes WHERE map_id = ? AND rev > ?`);
  const selectChangedArrows = db.prepare(`SELECT ${ARROW_COLUMNS} FROM arrows WHERE map_id = ? AND rev > ?`);

  // Purging: the maps with something deleted before the cutoff, then per map the deleted
  // branches whole (one statement, so no cascade has to run down them) and the deleted arrows.
  const selectPurgeable = db.prepare(`
    SELECT map_id FROM nodes WHERE deleted_at IS NOT NULL AND deleted_at < $cutoff
    UNION SELECT map_id FROM arrows WHERE deleted_at IS NOT NULL AND deleted_at < $cutoff`);
  const purgeNodes = db.prepare(`
    WITH RECURSIVE doomed(id) AS (
      SELECT id FROM nodes WHERE map_id = $map AND deleted_at IS NOT NULL AND deleted_at < $cutoff
      UNION
      SELECT n.id FROM nodes n JOIN doomed d ON n.parent_id = d.id
    )
    DELETE FROM nodes WHERE id IN (SELECT id FROM doomed)`);
  const purgeArrows = db.prepare(
    "DELETE FROM arrows WHERE map_id = $map AND deleted_at IS NOT NULL AND deleted_at < $cutoff",
  );
  const setPurged = db.prepare("UPDATE maps SET rev = rev + 1, purged_rev = rev + 1 WHERE id = ?");

  // $known: a JSON array of usernames.
  const UNKNOWN_OWNER = "owner NOT IN (SELECT value FROM json_each($known))";
  const countUnknownOwners = db.prepare(
    `SELECT owner, count(*) AS maps FROM maps WHERE ${UNKNOWN_OWNER} GROUP BY owner ORDER BY owner`,
  );
  // Maps take their nodes and arrows with them.
  const deleteUnknown = db.prepare(`DELETE FROM maps WHERE ${UNKNOWN_OWNER}`);

  const count = (n: unknown) => (n as { n: number }).n;
  const toSummary = (row: MapRow): MapSummary => ({ id: row.id, name: mapName(row.text), updatedAt: row.updated_at });
  const mapRows = (owner: string) => selectMaps.all(owner) as unknown as MapRow[];
  const mapRow = (owner: string, id: string) => (selectMap.get(owner, id) as MapRow | undefined) ?? notFound("map");
  const liveNodes = (mapId: string) => selectLive.all({ $map: mapId }) as unknown as NodeRow[];
  const liveArrows = (mapId: string) => selectArrows.all(mapId) as unknown as ArrowRow[];

  function load(owner: string, id: string): MapData {
    const row = mapRow(owner, id);
    return {
      map: toSummary(row),
      rev: row.rev,
      nodes: liveNodes(id).map(toNode),
      arrows: liveArrows(id).map(toArrow),
    };
  }

  /** Adds an empty map (just its root) at the end of the sidebar. Inside a transaction. */
  function addMap(owner: string, rootText: string): { mapId: string; rootId: string } {
    if (count(countMaps.get(owner)) >= LIMITS.maps) tooMany(`At most ${LIMITS.maps} maps`);
    const mapId = randomUUID();
    const rootId = randomUUID();
    const now = new Date().toISOString();
    insertMap.run(mapId, owner, rankAtEnd(mapRows(owner)), now, now);
    insertNode.run(rootId, mapId, null, ROOT_RANK, null, rootText, 0, now, now);
    return { mapId, rootId };
  }

  // ── Backup ─────────────────────────────────────────────────────────────────────────────────

  function exportMap(mapId: string): ExportMap {
    const rows = liveNodes(mapId);
    const kids = new Map<string | null, NodeRow[]>();
    for (const row of rows) {
      const list = kids.get(row.parent_id);
      if (list) list.push(row);
      else kids.set(row.parent_id, [row]);
    }
    for (const list of kids.values()) list.sort(compareSiblings);
    const root = kids.get(null)![0]!;

    // Pre-order, without recursion: a map may be thousands of levels deep.
    const index = new Map<string, number>();
    const out = (row: NodeRow): ExportNode => {
      const node: ExportNode = { text: row.text };
      if (row.side) node.side = row.side;
      if (row.collapsed) node.collapsed = true;
      return node;
    };
    const top = out(root);
    const stack: { row: NodeRow; node: ExportNode }[] = [{ row: root, node: top }];
    while (stack.length > 0) {
      const { row, node } = stack.pop()!;
      index.set(row.id, index.size);
      const children = kids.get(row.id) ?? [];
      if (children.length === 0) continue;
      node.children = children.map(out);
      for (let i = children.length - 1; i >= 0; i--) stack.push({ row: children[i]!, node: node.children[i]! });
    }

    const arrows: ExportArrow[] = [];
    for (const a of liveArrows(mapId)) {
      const from = index.get(a.from_id);
      const to = index.get(a.to_id);
      if (from === undefined || to === undefined) continue;
      arrows.push(a.label ? { from, to, label: a.label } : { from, to });
    }
    return { root: top, arrows };
  }

  /** A map from a backup, checked, without recursion. */
  function importMapOf(input: unknown): ImportMap {
    const m = objectBody(input, "A map");
    const nodes: ImportMap["nodes"] = [];
    const stack: { value: unknown; parent: number; depth: number }[] = [{ value: m.root, parent: -1, depth: 0 }];
    while (stack.length > 0) {
      const { value, parent, depth } = stack.pop()!;
      const n = objectBody(value, "A node");
      const err = textError(n.text);
      if (err) invalid(`A node's ${err}`);
      if (n.children !== undefined && !Array.isArray(n.children)) invalid("A node's children must be a list");
      if (nodes.length >= LIMITS.mapNodes) invalid(`A map holds at most ${LIMITS.mapNodes} nodes`);
      const side = depth === 1 && SIDES.includes(n.side as Side) ? (n.side as Side) : null;
      nodes.push({ text: n.text as string, side, collapsed: depth > 0 && n.collapsed === true, parent });
      const me = nodes.length - 1;
      const children = (n.children as unknown[] | undefined) ?? [];
      for (let i = children.length - 1; i >= 0; i--) stack.push({ value: children[i], parent: me, depth: depth + 1 });
    }

    if (m.arrows !== undefined && !Array.isArray(m.arrows)) invalid("arrows must be a list");
    const arrows: ImportMap["arrows"] = [];
    let droppedArrows = 0;
    for (const value of (m.arrows as unknown[] | undefined) ?? []) {
      const a = objectBody(value, "An arrow");
      const label = a.label ?? "";
      const err = labelError(label);
      if (err) invalid(`An arrow's ${err}`);
      const ok = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) < nodes.length;
      if (!ok(a.from) || !ok(a.to) || a.from === a.to || arrows.length >= LIMITS.mapArrows) {
        droppedArrows++;
        continue;
      }
      arrows.push({ from: a.from, to: a.to, label: label as string });
    }
    balanceSides(nodes);
    return { nodes, arrows, droppedArrows };
  }

  /** Main branches that came without a side go to the side with fewer nodes so far. */
  function balanceSides(nodes: ImportMap["nodes"]): void {
    const size = nodes.map(() => 1);
    for (let i = nodes.length - 1; i > 0; i--) size[nodes[i]!.parent] = size[nodes[i]!.parent]! + size[i]!;
    const total = { left: 0, right: 0 };
    const mains = nodes.flatMap((n, i) => (n.parent === 0 ? [i] : []));
    for (const i of mains) if (nodes[i]!.side) total[nodes[i]!.side!] += size[i]!;
    for (const i of mains) {
      if (nodes[i]!.side) continue;
      const side: Side = total.left < total.right ? "left" : "right";
      nodes[i]!.side = side;
      total[side] += size[i]!;
    }
  }

  return {
    // ── The sidebar ──────────────────────────────────────────────────────────────────────────

    list(owner: string): MapSummary[] {
      return mapRows(owner).map(toSummary);
    },

    /** A new map at the end of the sidebar: a root holding `text` and nothing else. */
    create(owner: string, input: unknown): MapData {
      const body = input === undefined ? {} : objectBody(input);
      const text = body.text ?? "";
      const err = textError(text);
      if (err) invalid(`The ${err}`);
      const { mapId } = transaction(db, () => addMap(owner, text as string));
      return load(owner, mapId);
    },

    /** Moves a map in the sidebar to after `afterId` (null: first). Answers the new list. */
    move(owner: string, id: string, input: unknown): MapSummary[] {
      const body = objectBody(input);
      const afterId = body.afterId;
      if (afterId !== null && (typeof afterId !== "string" || !afterId)) invalid("afterId must be an id, or null");
      return transaction(db, () => {
        mapRow(owner, id);
        const siblings: Ranked[] = mapRows(owner).filter((m) => m.id !== id);
        if (afterId !== null && !siblings.some((s) => s.id === afterId)) invalid("That map isn't there to follow");
        let rank = rankAfter(siblings, afterId);
        if (rank === null) {
          // Two maps with the same rank leave no room between them: spread them out first.
          const fresh = freshRanks(siblings.length);
          const respread = siblings.map((s, i) => {
            setMapRank.run(fresh[i]!, s.id);
            return { id: s.id, rank: fresh[i]! };
          });
          rank = rankAfter(respread, afterId)!;
        }
        setMapRank.run(rank, id);
        return mapRows(owner).map(toSummary);
      });
    },

    /** Deletes a map and everything in it, for good. */
    remove(owner: string, id: string): void {
      const { changes } = deleteMapRow.run(id, owner);
      if (changes === 0) notFound("map");
    },

    // ── One map ──────────────────────────────────────────────────────────────────────────────

    load,

    applyOps(owner: string, id: string, input: unknown): OpsResponse {
      mapRow(owner, id);
      return ops.applyOps(owner, id, objectBody(input).ops);
    },

    /** Every node and arrow changed after revision `since`, deleted ones included. */
    changes(owner: string, id: string, since: unknown): ChangesResponse {
      const from = Number(since);
      if (!Number.isSafeInteger(from) || from < 0) invalid("since must be a revision number");
      const row = mapRow(owner, id);
      if (from < row.purged_rev) return { reset: true };
      return {
        rev: row.rev,
        nodes: (selectChangedNodes.all(id, from) as unknown as NodeRow[]).map(toNode),
        arrows: (selectChangedArrows.all(id, from) as unknown as ArrowRow[]).map(toArrow),
      };
    },

    // ── Backup ───────────────────────────────────────────────────────────────────────────────

    /** Every map of the owner, or one. Deleted nodes and arrows are left out. */
    exportMaps(owner: string, id?: string): ExportFile {
      const rows = id === undefined ? mapRows(owner) : [mapRow(owner, id)];
      return {
        format: "mimir",
        version: 1,
        exportedAt: new Date().toISOString(),
        maps: rows.map((r) => exportMap(r.id)),
      };
    },

    /**
     * Adds the maps of a backup (or of an imported OPML file) as new maps at the end of the
     * sidebar. Nothing is merged, so restoring a file twice gives two copies. A bad file changes
     * nothing.
     */
    restore(owner: string, input: unknown): RestoreResult {
      const b = objectBody(input);
      if (b.format !== "mimir" || b.version !== 1) invalid("This is not a Mimir backup (format mimir, version 1)");
      if (!Array.isArray(b.maps)) invalid("The file must have a maps list");
      if (b.maps.length > LIMITS.maps) invalid(`At most ${LIMITS.maps} maps`);
      const maps = b.maps.map((value, i) => {
        try {
          return importMapOf(value);
        } catch (err) {
          if (err instanceof StoreError) invalid(`Map ${i + 1}: ${err.message}`);
          throw err;
        }
      });
      const adding = maps.reduce((n, m) => n + m.nodes.length, 0);

      return transaction(db, () => {
        if (count(countUserNodes.get(owner)) + adding > LIMITS.userNodes) {
          tooMany(`At most ${LIMITS.userNodes} nodes in all your maps`);
        }
        const now = new Date().toISOString();
        const ids: string[] = [];
        let droppedArrows = 0;
        for (const map of maps) {
          const { mapId, rootId } = addMap(owner, map.nodes[0]!.text);
          ids.push(mapId);
          droppedArrows += map.droppedArrows;
          const nodeIds = map.nodes.map((_, i) => (i === 0 ? rootId : randomUUID()));
          // Children come in order after their parent (pre-order), so ranks are handed out per parent.
          const childCount = map.nodes.map(() => 0);
          for (const n of map.nodes) if (n.parent >= 0) childCount[n.parent]!++;
          const ranks = new Map<number, string[]>();
          const used = map.nodes.map(() => 0);
          map.nodes.forEach((n, i) => {
            if (i === 0) return;
            let list = ranks.get(n.parent);
            if (!list) ranks.set(n.parent, (list = freshRanks(childCount[n.parent]!)));
            const rank = list[used[n.parent]!++]!;
            insertNode.run(nodeIds[i]!, mapId, nodeIds[n.parent]!, rank, n.side, n.text, n.collapsed ? 1 : 0, now, now);
          });
          for (const a of map.arrows) {
            insertArrow.run(randomUUID(), mapId, nodeIds[a.from]!, nodeIds[a.to]!, a.label, now, now);
          }
        }
        return { maps: maps.length, nodes: adding, droppedArrows, ids };
      });
    },

    // ── Clean-up ─────────────────────────────────────────────────────────────────────────────

    /**
     * Deletes for good the nodes (with their branches) and arrows deleted more than
     * PURGE_AFTER_DAYS ago. Pages that loaded such a map before then must load it again.
     * Returns how many maps were cleaned.
     */
    purge(now = new Date()): number {
      const $cutoff = new Date(now.getTime() - PURGE_AFTER_DAYS * 86_400_000).toISOString();
      const maps = selectPurgeable.all({ $cutoff }) as { map_id: string }[];
      for (const { map_id } of maps) {
        transaction(db, () => {
          purgeNodes.run({ $map: map_id, $cutoff });
          purgeArrows.run({ $map: map_id, $cutoff });
          setPurged.run(map_id);
        });
      }
      return maps.length;
    },

    /**
     * Deletes for good every map of every owner who isn't in `known` (Heimdall's usernames), i.e.
     * of users removed from Heimdall. Returns how many maps each had.
     */
    removeUnknownOwners(known: ReadonlySet<string>): { owner: string; maps: number }[] {
      const $known = JSON.stringify([...known]);
      return transaction(db, () => {
        const removed = countUnknownOwners.all({ $known }) as { owner: string; maps: number }[];
        deleteUnknown.run({ $known });
        return removed;
      });
    },
  };
}

export type Maps = ReturnType<typeof createMaps>;
