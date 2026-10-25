import { createHash, randomBytes, randomInt } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { hashPassword, verifyPassword } from "./password.ts";

// Players, their sessions and the invite codes that let them join. Saga has its own accounts:
// it never asks Heimdall who is signed in.

/** The hero looks a player can pick. Keep in step with AVATARS in web/data.js. */
export const AVATARS = ["knight", "ranger", "sage", "minstrel", "mystic", "envoy"] as const;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;
export const HERO_NAME_MAX = 20;
const USERNAME = /^[A-Za-z0-9._-]{3,24}$/;

/** A session lasts this long at most, and ends sooner if nobody uses it for SESSION_IDLE_MS. */
export const SESSION_MAX_MS = 90 * 24 * 60 * 60_000;
export const SESSION_IDLE_MS = 30 * 24 * 60 * 60_000;
// Use is recorded at most this often, so playing doesn't write the sessions table every second.
const TOUCH_EVERY_MS = 60 * 60_000;
export const INVITE_DAYS = 30;

/** A request that can't be done, with the status and message the API answers with. */
export class AccountError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface Player {
  id: number;
  username: string;
  heroName: string;
  avatar: string;
  mustChangePassword: boolean;
}

export interface Invite {
  code: string;
  note: string;
  createdAt: string;
  expiresAt: string;
  usedBy: string | null;
  usedAt: string | null;
}

interface PlayerRow {
  id: number;
  username: string;
  password_hash: string;
  must_change_password: number;
  hero_name: string;
  avatar: string;
}

const toPlayer = (r: PlayerRow): Player => ({
  id: r.id,
  username: r.username,
  heroName: r.hero_name,
  avatar: r.avatar,
  mustChangePassword: r.must_change_password === 1,
});

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// Invite codes and temporary passwords use letters and digits that can't be mistaken for each
// other when read out or copied by hand (no 0/O, 1/I/L).
const CODE_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const randomChars = (n: number) => Array.from({ length: n }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");

/** An invite code as typed (any case, spaces, with or without SAGA- and dashes) in its stored form. */
export function normalizeInvite(typed: string): string {
  const chars = typed.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = chars.startsWith("SAGA") && chars.length === 12 ? chars.slice(4) : chars;
  return body.length === 8 ? `SAGA-${body.slice(0, 4)}-${body.slice(4)}` : "";
}

/** A hero name with its spaces tidied, or the reason it can't be used. */
export function cleanHeroName(name: unknown): string {
  if (typeof name !== "string") throw new AccountError(400, "Give your hero a name.");
  const clean = name.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!clean) throw new AccountError(400, "Give your hero a name.");
  if ([...clean].length > HERO_NAME_MAX)
    throw new AccountError(400, `A hero name has at most ${HERO_NAME_MAX} letters.`);
  if (/\p{C}/u.test(clean)) throw new AccountError(400, "That hero name has characters that can't be shown.");
  return clean;
}

function checkAvatar(avatar: unknown): string {
  if (typeof avatar !== "string" || !(AVATARS as readonly string[]).includes(avatar)) {
    throw new AccountError(400, "Choose one of the looks.");
  }
  return avatar;
}

function checkPassword(password: unknown): string {
  if (typeof password !== "string" || password.length < PASSWORD_MIN) {
    throw new AccountError(400, `A password needs at least ${PASSWORD_MIN} characters.`);
  }
  if (password.length > PASSWORD_MAX) throw new AccountError(400, `A password has at most ${PASSWORD_MAX} characters.`);
  return password;
}

// Compared against when a username doesn't exist, so a wrong name takes as long as a wrong password.
const DUMMY_HASH = await hashPassword(randomBytes(16).toString("hex"));

export function createAccounts(db: DatabaseSync, now: () => number = Date.now) {
  const iso = (ms = now()) => new Date(ms).toISOString();

  const byId = db.prepare("SELECT * FROM players WHERE id = ?");
  const byUsername = db.prepare("SELECT * FROM players WHERE username = ?");
  const heroTaken = db.prepare("SELECT 1 FROM players WHERE hero_name = ? AND id != ?");

  function findByUsername(username: string): PlayerRow | undefined {
    return byUsername.get(username) as PlayerRow | undefined;
  }

  function requireUsername(username: string): PlayerRow {
    const row = findByUsername(username);
    if (!row) throw new AccountError(404, `No player is called ${username}.`);
    return row;
  }

  function checkHeroFree(heroName: string, exceptId = 0) {
    if (heroTaken.get(heroName, exceptId)) throw new AccountError(409, `There is already a hero called ${heroName}.`);
  }

  // ---- Invites ---------------------------------------------------------------------------------

  function createInvite(note = ""): Invite {
    const code = `SAGA-${randomChars(4)}-${randomChars(4)}`;
    const createdAt = iso();
    const expiresAt = iso(now() + INVITE_DAYS * 24 * 60 * 60_000);
    db.prepare("INSERT INTO invites (code, note, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
      code,
      note.trim(),
      createdAt,
      expiresAt,
    );
    return { code, note: note.trim(), createdAt, expiresAt, usedBy: null, usedAt: null };
  }

  function listInvites(): Invite[] {
    const rows = db
      .prepare(
        `SELECT i.code, i.note, i.created_at, i.expires_at, i.used_at, p.username
         FROM invites i LEFT JOIN players p ON p.id = i.used_by ORDER BY i.created_at DESC`,
      )
      .all() as {
      code: string;
      note: string;
      created_at: string;
      expires_at: string;
      used_at: string | null;
      username: string | null;
    }[];
    return rows.map((r) => ({
      code: r.code,
      note: r.note,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      usedBy: r.username,
      usedAt: r.used_at,
    }));
  }

  // ---- Joining and signing in --------------------------------------------------------------------

  /** Makes a player from an unused invite. The invite is spent in the same transaction. */
  async function signUp(input: {
    invite: unknown;
    username: unknown;
    password: unknown;
    heroName: unknown;
    avatar: unknown;
  }): Promise<Player> {
    const code = typeof input.invite === "string" ? normalizeInvite(input.invite) : "";
    if (typeof input.username !== "string" || !USERNAME.test(input.username)) {
      throw new AccountError(400, "A username has 3 to 24 letters, digits, dots, dashes or underscores.");
    }
    const username = input.username;
    const password = checkPassword(input.password);
    const heroName = cleanHeroName(input.heroName);
    const avatar = checkAvatar(input.avatar);
    const hash = await hashPassword(password);

    const invite = db.prepare("SELECT expires_at, used_at FROM invites WHERE code = ?").get(code) as
      { expires_at: string; used_at: string | null } | undefined;
    if (!invite || invite.used_at) throw new AccountError(403, "That invite code isn't valid, or was already used.");
    if (invite.expires_at <= iso()) throw new AccountError(403, "That invite code has expired. Ask for a new one.");
    if (findByUsername(username)) throw new AccountError(409, "That username is taken.");
    checkHeroFree(heroName);

    db.exec("BEGIN");
    try {
      const { lastInsertRowid } = db
        .prepare("INSERT INTO players (username, password_hash, hero_name, avatar, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(username, hash, heroName, avatar, iso());
      const spent = db
        .prepare("UPDATE invites SET used_by = ?, used_at = ? WHERE code = ? AND used_at IS NULL")
        .run(lastInsertRowid, iso(), code);
      // Two sign-ups racing for one code: the second finds it spent.
      if (spent.changes !== 1) throw new AccountError(403, "That invite code was just used.");
      db.exec("COMMIT");
      return toPlayer(byId.get(lastInsertRowid) as unknown as PlayerRow);
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  /** The player with this username and password, or null. Always takes about as long. */
  async function signIn(username: unknown, password: unknown): Promise<Player | null> {
    const row = typeof username === "string" ? findByUsername(username) : undefined;
    const ok = await verifyPassword(typeof password === "string" ? password : "", row?.password_hash ?? DUMMY_HASH);
    return row && ok ? toPlayer(row) : null;
  }

  // ---- Sessions ----------------------------------------------------------------------------------

  /** A new session for the player. The token goes in the cookie; only its hash is stored. */
  function createSession(playerId: number): string {
    const token = randomBytes(32).toString("base64url");
    const at = iso();
    db.prepare("INSERT INTO sessions (token_hash, player_id, created_at, last_used_at) VALUES (?, ?, ?, ?)").run(
      sha256(token),
      playerId,
      at,
      at,
    );
    db.prepare("UPDATE players SET last_seen_at = ? WHERE id = ?").run(at, playerId);
    return token;
  }

  /** The player a session belongs to, if it hasn't ended. Counts as use of the session. */
  function sessionPlayer(token: string | undefined): Player | null {
    if (!token) return null;
    const hash = sha256(token);
    const s = db.prepare("SELECT player_id, created_at, last_used_at FROM sessions WHERE token_hash = ?").get(hash) as
      { player_id: number; created_at: string; last_used_at: string } | undefined;
    if (!s) return null;
    const t = now();
    const lastUsed = Date.parse(s.last_used_at);
    if (t - Date.parse(s.created_at) > SESSION_MAX_MS || t - lastUsed > SESSION_IDLE_MS) {
      db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash);
      return null;
    }
    if (t - lastUsed > TOUCH_EVERY_MS) {
      db.prepare("UPDATE sessions SET last_used_at = ? WHERE token_hash = ?").run(iso(t), hash);
      db.prepare("UPDATE players SET last_seen_at = ? WHERE id = ?").run(iso(t), s.player_id);
    }
    const row = byId.get(s.player_id) as PlayerRow | undefined;
    return row ? toPlayer(row) : null;
  }

  function endSession(token: string | undefined) {
    if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
  }

  /** Deletes the sessions that have ended. Returns how many. */
  function dropEndedSessions(): number {
    const t = now();
    return Number(
      db
        .prepare("DELETE FROM sessions WHERE created_at < ? OR last_used_at < ?")
        .run(iso(t - SESSION_MAX_MS), iso(t - SESSION_IDLE_MS)).changes,
    );
  }

  // ---- The player's own changes ------------------------------------------------------------------

  async function requirePassword(playerId: number, password: unknown) {
    const row = byId.get(playerId) as PlayerRow | undefined;
    if (!row || typeof password !== "string" || !(await verifyPassword(password, row.password_hash))) {
      throw new AccountError(403, "That isn't your current password.");
    }
  }

  /** Sets a new password and signs out every other session of the player. */
  async function changePassword(playerId: number, current: unknown, next: unknown, keepToken?: string) {
    const password = checkPassword(next);
    await requirePassword(playerId, current);
    const hash = await hashPassword(password);
    db.prepare("UPDATE players SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(hash, playerId);
    db.prepare("DELETE FROM sessions WHERE player_id = ? AND token_hash != ?").run(
      playerId,
      keepToken ? sha256(keepToken) : "",
    );
  }

  function setHero(playerId: number, name: unknown, avatar: unknown): Player {
    const heroName = cleanHeroName(name);
    const look = checkAvatar(avatar);
    checkHeroFree(heroName, playerId);
    db.prepare("UPDATE players SET hero_name = ?, avatar = ? WHERE id = ?").run(heroName, look, playerId);
    return toPlayer(byId.get(playerId) as unknown as PlayerRow);
  }

  /** Deletes the player, with their sessions and saved game. */
  async function deleteAccount(playerId: number, password: unknown) {
    await requirePassword(playerId, password);
    db.prepare("DELETE FROM players WHERE id = ?").run(playerId);
  }

  // ---- The owner's commands ----------------------------------------------------------------------

  /** Gives the player a temporary password, which they must change after signing in. */
  async function resetPassword(username: string): Promise<string> {
    const row = requireUsername(username);
    const temporary = `${randomChars(4)}-${randomChars(4)}-${randomChars(4)}`.toLowerCase();
    db.prepare("UPDATE players SET password_hash = ?, must_change_password = 1 WHERE id = ?").run(
      await hashPassword(temporary),
      row.id,
    );
    db.prepare("DELETE FROM sessions WHERE player_id = ?").run(row.id);
    return temporary;
  }

  function renameHero(username: string, name: unknown): Player {
    const row = requireUsername(username);
    return setHero(row.id, name, row.avatar);
  }

  function removePlayer(username: string) {
    db.prepare("DELETE FROM players WHERE id = ?").run(requireUsername(username).id);
  }

  function listPlayers() {
    return db
      .prepare(
        `SELECT p.username, p.hero_name AS heroName, p.created_at AS createdAt, p.last_seen_at AS lastSeenAt,
                s.level, s.fame
         FROM players p LEFT JOIN saves s ON s.player_id = p.id ORDER BY p.created_at`,
      )
      .all() as {
      username: string;
      heroName: string;
      createdAt: string;
      lastSeenAt: string | null;
      level: number | null;
      fame: number | null;
    }[];
  }

  return {
    createInvite,
    listInvites,
    signUp,
    signIn,
    createSession,
    sessionPlayer,
    endSession,
    dropEndedSessions,
    changePassword,
    setHero,
    deleteAccount,
    resetPassword,
    renameHero,
    removePlayer,
    listPlayers,
  };
}

export type Accounts = ReturnType<typeof createAccounts>;
