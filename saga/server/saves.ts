import type { DatabaseSync } from "node:sqlite";

// Each player's saved game and the public ranking. The browser runs the game and sends all of it
// on every save, with a summary of the numbers the ranking sorts by. The game is played on trust
// (an attack is "I did this habit"), so the server checks only the shape of what it gets.

export const RANKING_SIZE = 100;
const MAX_NUMBER = 1_000_000_000;

/** The numbers the ranking is made of, worked out by the game from its state. */
export interface Summary {
  level: number;
  fame: number;
  front: number;
  dragonKills: number;
  dragonKinds: number;
  loops: number;
  habits: number;
}
const SUMMARY_KEYS = ["level", "fame", "front", "dragonKills", "dragonKinds", "loops", "habits"] as const;

export interface Save {
  revision: number;
  state: Record<string, unknown>;
}

export type SaveResult = { ok: true; revision: number } | { ok: false; current: Save };

export interface RankRow {
  rank: number;
  heroName: string;
  avatar: string;
  level: number;
  fame: number;
  front: number;
  dragonKills: number;
  dragonKinds: number;
  loops: number;
  you: boolean;
}

/** The summary from a request body, or null if any number is missing or out of range. */
export function parseSummary(body: unknown): Summary | null {
  if (!body || typeof body !== "object") return null;
  const out: Partial<Summary> = {};
  for (const key of SUMMARY_KEYS) {
    const v = (body as Record<string, unknown>)[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_NUMBER) return null;
    out[key] = v;
  }
  return out as Summary;
}

/** The game state from a request body: an object with a numeric version, `v`. */
export function parseState(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const v = (body as { v?: unknown }).v;
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? (body as Record<string, unknown>) : null;
}

export function createSaves(db: DatabaseSync, now: () => number = Date.now) {
  function load(playerId: number): Save | null {
    const row = db.prepare("SELECT revision, state FROM saves WHERE player_id = ?").get(playerId) as
      { revision: number; state: string } | undefined;
    return row ? { revision: row.revision, state: JSON.parse(row.state) as Record<string, unknown> } : null;
  }

  /**
   * Saves the game if `baseRevision` is the revision it was loaded or last saved at (0 for a
   * first save). Otherwise another tab or device saved in between, and the newer save is returned
   * instead of being overwritten.
   */
  function save(playerId: number, baseRevision: number, state: Record<string, unknown>, s: Summary): SaveResult {
    const json = JSON.stringify(state);
    const at = new Date(now()).toISOString();
    const values = [s.level, s.fame, s.front, s.dragonKills, s.dragonKinds, s.loops, s.habits];
    const result =
      baseRevision === 0
        ? db
            .prepare(
              `INSERT INTO saves (player_id, revision, game_version, state, updated_at,
                 level, fame, front_index, dragon_kills, dragon_kinds, loops, habit_count)
               VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (player_id) DO NOTHING`,
            )
            .run(playerId, state.v as number, json, at, ...values)
        : db
            .prepare(
              `UPDATE saves SET revision = revision + 1, game_version = ?, state = ?, updated_at = ?,
                 level = ?, fame = ?, front_index = ?, dragon_kills = ?, dragon_kinds = ?, loops = ?, habit_count = ?
               WHERE player_id = ? AND revision = ?`,
            )
            .run(state.v as number, json, at, ...values, playerId, baseRevision);
    if (result.changes === 1) return { ok: true, revision: baseRevision + 1 };
    const current = load(playerId);
    // A save that was cleared in the meantime: this one is the first again.
    if (!current) return save(playerId, 0, state, s);
    return { ok: false, current };
  }

  /** Forgets the player's game, for starting over. The account stays. */
  function clear(playerId: number) {
    db.prepare("DELETE FROM saves WHERE player_id = ?").run(playerId);
  }

  /**
   * The best players by fame (ties by level) or by level (ties by fame); on a full tie, whoever
   * joined first. Players with no habits yet are left out. With `playerId`, that player's own row
   * comes too, even when it is below the top.
   */
  function ranking(by: "fame" | "level", playerId = 0): { rows: RankRow[]; you: RankRow | null } {
    const order = by === "level" ? "s.level DESC, s.fame DESC" : "s.fame DESC, s.level DESC";
    const rows = db
      .prepare(
        `WITH ranked AS (
           SELECT ROW_NUMBER() OVER (ORDER BY ${order}, p.created_at, p.id) AS rank,
                  p.id, p.hero_name, p.avatar, s.level, s.fame, s.front_index, s.dragon_kills, s.dragon_kinds, s.loops
           FROM saves s JOIN players p ON p.id = s.player_id
           WHERE s.habit_count > 0
         )
         SELECT * FROM ranked WHERE rank <= ? OR id = ? ORDER BY rank`,
      )
      .all(RANKING_SIZE, playerId) as {
      rank: number;
      id: number;
      hero_name: string;
      avatar: string;
      level: number;
      fame: number;
      front_index: number;
      dragon_kills: number;
      dragon_kinds: number;
      loops: number;
    }[];
    const all = rows.map((r): RankRow => ({
      rank: r.rank,
      heroName: r.hero_name,
      avatar: r.avatar,
      level: r.level,
      fame: r.fame,
      front: r.front_index,
      dragonKills: r.dragon_kills,
      dragonKinds: r.dragon_kinds,
      loops: r.loops,
      you: r.id === playerId,
    }));
    return { rows: all.filter((r) => r.rank <= RANKING_SIZE), you: all.find((r) => r.you) ?? null };
  }

  return { load, save, clear, ranking };
}

export type Saves = ReturnType<typeof createSaves>;
