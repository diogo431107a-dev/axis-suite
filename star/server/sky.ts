// Every read and write of a user's sky. A batch of ops is checked as it is applied, in one
// transaction, so a refused op leaves nothing of its batch behind.
import type { DatabaseSync } from "node:sqlite";
import { HUES, LIMITS, type Link, type Op, type OpsResult, type Sky, type Star } from "../shared/protocol.ts";
import { invalid, notFound, tooMany, transaction } from "./errors.ts";

interface StarRow {
  id: string;
  name: string;
  memo: string;
  parent_id: string | null;
  relation: string;
  hue: number;
  x: number;
  y: number;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

function object(input: unknown, what: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) invalid(`${what} must be a JSON object`);
  return input as Record<string, unknown>;
}

function id(input: unknown, what: string): string {
  if (typeof input !== "string" || !ID.test(input)) invalid(`${what} is not a valid id`);
  return input;
}

function text(input: unknown, what: string, max: number): string {
  if (typeof input !== "string") invalid(`${what} must be text`);
  if (input.length > max) invalid(`${what} can have at most ${max} characters`);
  return input;
}

function coordinate(input: unknown): number {
  if (typeof input !== "number" || !Number.isFinite(input) || Math.abs(input) > LIMITS.coordinate) {
    invalid("A star's position must be a number within the sky");
  }
  return input;
}

function hue(input: unknown): number {
  if (typeof input !== "number" || !Number.isInteger(input) || input < 0 || input >= HUES) {
    invalid(`A hue must be a whole number from 0 to ${HUES - 1}`);
  }
  return input;
}

export function createSky(db: DatabaseSync) {
  const skyRow = db.prepare("SELECT rev, last_batch FROM skies WHERE owner = ?");
  const starRows = db.prepare(
    "SELECT id, name, memo, parent_id, relation, hue, x, y FROM stars WHERE owner = ? ORDER BY seq",
  );
  const linkRows = db.prepare(
    "SELECT id, a_id AS a, b_id AS b, relation FROM links WHERE owner = ? ORDER BY created_at, id",
  );
  const saveBatch = db.prepare(`
    INSERT INTO skies (owner, rev, last_batch) VALUES ($owner, $rev, $batch)
    ON CONFLICT (owner) DO UPDATE SET rev = $rev, last_batch = $batch
  `);

  const ownerOfStar = db.prepare("SELECT owner, parent_id FROM stars WHERE id = ?");
  const ownerOfLink = db.prepare("SELECT owner FROM links WHERE id = ?");
  const countStars = db.prepare("SELECT count(*) AS n FROM stars WHERE owner = ?");
  const countLinks = db.prepare("SELECT count(*) AS n FROM links WHERE owner = ?");
  const nextSeq = db.prepare("SELECT coalesce(max(seq), 0) + 1 AS seq FROM stars WHERE owner = ?");
  const insertStar = db.prepare(`
    INSERT INTO stars (id, owner, seq, parent_id, name, memo, relation, hue, x, y, created_at, updated_at)
    VALUES ($id, $owner, $seq, $parent, $name, $memo, $relation, $hue, $x, $y, $now, $now)
  `);
  const updateStar = db.prepare(`
    UPDATE stars SET
      name = coalesce($name, name), memo = coalesce($memo, memo), relation = coalesce($relation, relation),
      updated_at = $now
    WHERE id = $id
  `);
  const moveStar = db.prepare("UPDATE stars SET x = $x, y = $y WHERE id = $id");
  const deleteBranch = db.prepare(`
    DELETE FROM stars WHERE id IN (
      WITH RECURSIVE branch(id) AS (
        SELECT id FROM stars WHERE id = ?
        UNION ALL
        SELECT stars.id FROM stars JOIN branch ON stars.parent_id = branch.id
      )
      SELECT id FROM branch
    )
  `);
  const promote = db.prepare(`
    UPDATE stars SET parent_id = NULL, relation = '', hue = $hue, updated_at = $now WHERE id = $id
  `);
  const relationOf = db.prepare("SELECT relation FROM stars WHERE id = ?");
  const findPair = db.prepare(
    "SELECT 1 FROM links WHERE min(a_id, b_id) = min($a, $b) AND max(a_id, b_id) = max($a, $b)",
  );
  const insertLink = db.prepare(`
    INSERT INTO links (id, owner, a_id, b_id, relation, created_at) VALUES ($id, $owner, $a, $b, $relation, $now)
  `);
  const deleteLink = db.prepare("DELETE FROM links WHERE id = ?");

  const countUnknownOwners = db.prepare(`
    SELECT owner, count(*) AS stars FROM stars
    WHERE owner NOT IN (SELECT value FROM json_each($known)) GROUP BY owner ORDER BY owner
  `);
  const deleteUnknownStars = db.prepare("DELETE FROM stars WHERE owner NOT IN (SELECT value FROM json_each($known))");
  const deleteUnknownSkies = db.prepare("DELETE FROM skies WHERE owner NOT IN (SELECT value FROM json_each($known))");

  /** The star, if it is this user's. Someone else's looks the same as one that doesn't exist. */
  function ownStar(owner: string, starId: string): { parent_id: string | null } {
    const row = ownerOfStar.get(starId) as { owner: string; parent_id: string | null } | undefined;
    if (!row || row.owner !== owner) notFound("star");
    return row;
  }

  function addLink(owner: string, linkId: string, a: string, b: string, relation: string, now: string): void {
    if (ownerOfLink.get(linkId)) invalid("That connection's id is already in use");
    if ((countLinks.get(owner) as { n: number }).n >= LIMITS.linksPerUser) {
      tooMany(`A sky can have at most ${LIMITS.linksPerUser} connections`);
    }
    insertLink.run({ $id: linkId, $owner: owner, $a: a, $b: b, $relation: relation, $now: now });
  }

  function apply(owner: string, input: Op, now: string): void {
    const op = object(input, "An op");
    switch (op.op) {
      case "addStar": {
        const star = object(op.star, "A star");
        const starId = id(star.id, "A star");
        if (ownerOfStar.get(starId)) invalid("That star's id is already in use");
        const parent = star.parent === null ? null : id(star.parent, "A star's parent");
        if (parent !== null) ownStar(owner, parent);
        if ((countStars.get(owner) as { n: number }).n >= LIMITS.starsPerUser) {
          tooMany(`A sky can have at most ${LIMITS.starsPerUser} stars`);
        }
        insertStar.run({
          $id: starId,
          $owner: owner,
          $seq: (nextSeq.get(owner) as { seq: number }).seq,
          $parent: parent,
          $name: text(star.name, "A name", LIMITS.name),
          $memo: text(star.memo, "A memo", LIMITS.memo),
          $relation: parent === null ? "" : text(star.relation, "A relation", LIMITS.relation),
          $hue: hue(star.hue),
          $x: coordinate(star.x),
          $y: coordinate(star.y),
          $now: now,
        });
        return;
      }
      case "updateStar": {
        const starId = id(op.id, "A star");
        const star = ownStar(owner, starId);
        if (op.relation !== undefined && star.parent_id === null) invalid("A main star has no relation");
        updateStar.run({
          $id: starId,
          $name: op.name === undefined ? null : text(op.name, "A name", LIMITS.name),
          $memo: op.memo === undefined ? null : text(op.memo, "A memo", LIMITS.memo),
          $relation: op.relation === undefined ? null : text(op.relation, "A relation", LIMITS.relation),
          $now: now,
        });
        return;
      }
      case "moveStars": {
        if (!Array.isArray(op.moves)) invalid("moves must be a list");
        if (op.moves.length > LIMITS.starsPerUser) invalid("Too many stars moved at once");
        for (const item of op.moves as unknown[]) {
          const move = object(item, "A move");
          const starId = id(move.id, "A star");
          ownStar(owner, starId);
          moveStar.run({ $id: starId, $x: coordinate(move.x), $y: coordinate(move.y) });
        }
        return;
      }
      case "removeStar": {
        const starId = id(op.id, "A star");
        ownStar(owner, starId);
        deleteBranch.run(starId);
        return;
      }
      case "promoteStar": {
        const starId = id(op.id, "A star");
        const parent = ownStar(owner, starId).parent_id;
        if (parent === null) invalid("That star is already a main star");
        const { relation } = relationOf.get(starId) as { relation: string };
        promote.run({ $id: starId, $hue: hue(op.hue), $now: now });
        addLink(owner, id(op.linkId, "A connection"), parent, starId, relation, now);
        return;
      }
      case "addLink": {
        const link = object(op.link, "A connection");
        const a = id(link.a, "A star");
        const b = id(link.b, "A star");
        if (a === b) invalid("A star can't be connected to itself");
        const starA = ownStar(owner, a);
        const starB = ownStar(owner, b);
        if (starA.parent_id === b || starB.parent_id === a) invalid("Those two stars are already tied together");
        if (findPair.get({ $a: a, $b: b })) invalid("Those two stars are already connected");
        const relation = text(link.relation, "A relation", LIMITS.relation);
        addLink(owner, id(link.id, "A connection"), a, b, relation, now);
        return;
      }
      case "removeLink": {
        const linkId = id(op.id, "A connection");
        const row = ownerOfLink.get(linkId) as { owner: string } | undefined;
        if (!row || row.owner !== owner) notFound("connection");
        deleteLink.run(linkId);
        return;
      }
      default:
        invalid("Unknown op");
    }
  }

  return {
    load(owner: string): Sky {
      const stars = (starRows.all(owner) as unknown as StarRow[]).map(({ parent_id, ...star }): Star => ({
        ...star,
        parent: parent_id,
      }));
      const links = linkRows.all(owner) as unknown as Link[];
      const sky = skyRow.get(owner) as { rev: number } | undefined;
      return { stars, links, rev: sky?.rev ?? 0 };
    },

    applyOps(owner: string, input: unknown): OpsResult {
      const body = object(input, "The request body");
      const batch = id(body.batch, "The batch");
      if (!Array.isArray(body.ops)) invalid("ops must be a list");
      if (body.ops.length > LIMITS.opsPerBatch) invalid(`A batch can have at most ${LIMITS.opsPerBatch} ops`);
      const ops = body.ops as Op[];
      return transaction(db, () => {
        const sky = skyRow.get(owner) as { rev: number; last_batch: string | null } | undefined;
        const rev = sky?.rev ?? 0;
        if (sky?.last_batch === batch || ops.length === 0) return { rev };
        const now = new Date().toISOString();
        for (const op of ops) apply(owner, op, now);
        saveBatch.run({ $owner: owner, $rev: rev + 1, $batch: batch });
        return { rev: rev + 1 };
      });
    },

    /** Deletes the sky of everyone not in `known`, and says whose went. */
    removeUnknownOwners(known: ReadonlySet<string>): { owner: string; stars: number }[] {
      const $known = JSON.stringify([...known]);
      return transaction(db, () => {
        const removed = countUnknownOwners.all({ $known }) as unknown as { owner: string; stars: number }[];
        deleteUnknownStars.run({ $known });
        deleteUnknownSkies.run({ $known });
        return removed;
      });
    },
  };
}

export type SkyStore = ReturnType<typeof createSky>;
