// Sessions (saved to disk, so they survive restarts) and login throttling (in memory).
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { USERS, type User } from "./users.ts";

export const MAX_ATTEMPTS = 3;
export const LOCKOUT_MS = 5 * 60_000;
/** Users must log in again this long after logging in, however active they are. */
export const SESSION_MAX_MS = 14 * 24 * 60 * 60_000;
/** A session nobody has used for this long ends, e.g. one left open on a shared computer. */
export const SESSION_IDLE_MS = 48 * 60 * 60_000;
// Use is recorded at most this often, so the sessions file isn't rewritten on every request.
const TOUCH_INTERVAL_MS = 5 * 60_000;

// ---- Sessions -------------------------------------------------------------

// systemd sets STATE_DIRECTORY (/var/lib/heimdall); locally it falls back to ./data.
const STATE_DIR = process.env.STATE_DIRECTORY ?? "data";
const SESSIONS_FILE = join(STATE_DIR, "sessions.json");

interface StoredSession {
  username: string;
  /** Fingerprint of the user's password hash at login; see credentialStamp(). */
  stamp: string;
  loginAt: number;
  /** Last use, by Heimdall's own page or a module asking /whoami. Accurate to TOUCH_INTERVAL_MS. */
  lastSeenAt: number;
  /** The hard limit: loginAt + SESSION_MAX_MS. */
  expiresAt: number;
}

export interface Session extends StoredSession {
  name: string;
}

// Keyed by a SHA-256 of the cookie value, so the file on disk holds no usable tokens.
const sessions = loadSessions();

function tokenKey(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

// Changes whenever the user's passwordHash in users.ts changes, which ends every
// session opened with the old credentials.
function credentialStamp(user: User): string {
  return createHash("sha256").update(user.passwordHash).digest("base64url").slice(0, 22);
}

function findUser(s: StoredSession): User | undefined {
  return USERS.find((u) => u.username === s.username);
}

/** Why a stored session can no longer be used, or null if it still can. */
function endReason(s: StoredSession, now = Date.now()): string | null {
  if (s.expiresAt <= now) return `${SESSION_MAX_MS / 86_400_000} days since sign-in`;
  if (now - s.lastSeenAt >= SESSION_IDLE_MS) return `idle for ${SESSION_IDLE_MS / 3_600_000} hours`;
  const user = findUser(s);
  if (!user) return "user removed";
  if (s.stamp !== credentialStamp(user)) return "credentials changed";
  return null;
}

/** When the session ends unless it is used again. */
export function idleEndsAt(s: StoredSession): number {
  return Math.min(s.lastSeenAt + SESSION_IDLE_MS, s.expiresAt);
}

function loadSessions(): Map<string, StoredSession> {
  try {
    const entries = JSON.parse(readFileSync(SESSIONS_FILE, "utf8")) as [string, StoredSession][];
    const now = Date.now();
    // Sessions saved before the idle timeout existed start their idle clock now.
    for (const [, s] of entries) s.lastSeenAt ??= now;
    const valid = entries.filter(([, s]) => !endReason(s, now));
    const dropped = entries.length - valid.length;
    if (dropped > 0) {
      console.log(`Dropped ${dropped} saved session(s): expired, idle, user removed or credentials changed`);
    }
    return new Map(valid);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("Could not read saved sessions, starting with none:", err);
    }
    return new Map();
  }
}

function saveSessions(): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    const tmp = `${SESSIONS_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify([...sessions]), { mode: 0o600 });
    renameSync(tmp, SESSIONS_FILE);
  } catch (err) {
    console.error("Could not save sessions:", err);
  }
}

export function createSession(user: User): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = now + SESSION_MAX_MS;
  sessions.set(tokenKey(token), {
    username: user.username,
    stamp: credentialStamp(user),
    loginAt: now,
    lastSeenAt: now,
    expiresAt,
  });
  saveSessions();
  return { token, expiresAt };
}

export function getSession(token: string | undefined): Session | null {
  if (!token) return null;
  const key = tokenKey(token);
  const stored = sessions.get(key);
  if (!stored) return null;
  const reason = endReason(stored);
  const user = findUser(stored);
  if (reason || !user) {
    console.log(`Ended a session for ${stored.username}: ${reason}`);
    sessions.delete(key);
    saveSessions();
    return null;
  }
  return { ...stored, name: user.name };
}

/** Records that the session was used, which restarts its idle clock. */
export function touchSession(token: string | undefined): void {
  const stored = token ? sessions.get(tokenKey(token)) : undefined;
  const now = Date.now();
  if (!stored || now - stored.lastSeenAt < TOUCH_INTERVAL_MS) return;
  stored.lastSeenAt = now;
  saveSessions();
}

export function destroySession(token: string | undefined): void {
  if (token && sessions.delete(tokenKey(token))) saveSessions();
}

// ---- Failed-login lockout (keyed by client IP) ----------------------------

interface AttemptRecord {
  failures: number;
  lastFailure: number;
  lockedUntil: number;
}

const attempts = new Map<string, AttemptRecord>();

/** Milliseconds left on this client's lockout, or 0 if it may try to log in. */
export function lockedFor(key: string): number {
  const record = attempts.get(key);
  return record ? Math.max(0, record.lockedUntil - Date.now()) : 0;
}

/** Records a failed attempt. Returns attempts left before lockout, and the lockout length if it just started. */
export function recordFailure(key: string): { remaining: number; lockedMs: number } {
  const now = Date.now();
  let record = attempts.get(key);
  // A streak of failures is forgotten after a quiet period as long as the lockout.
  if (!record || now - record.lastFailure > LOCKOUT_MS) {
    record = { failures: 0, lastFailure: now, lockedUntil: 0 };
    attempts.set(key, record);
  }
  record.failures += 1;
  record.lastFailure = now;
  if (record.failures >= MAX_ATTEMPTS) {
    record.failures = 0;
    record.lockedUntil = now + LOCKOUT_MS;
    return { remaining: 0, lockedMs: LOCKOUT_MS };
  }
  return { remaining: MAX_ATTEMPTS - record.failures, lockedMs: 0 };
}

export function clearFailures(key: string): void {
  attempts.delete(key);
}

// Drop ended sessions and stale attempt records so memory stays bounded.
setInterval(() => {
  const now = Date.now();
  let expired = false;
  for (const [key, s] of sessions) {
    if (endReason(s, now)) expired = sessions.delete(key);
  }
  if (expired) saveSessions();
  for (const [key, r] of attempts) {
    if (r.lockedUntil <= now && now - r.lastFailure > LOCKOUT_MS) attempts.delete(key);
  }
}, 60_000).unref();
