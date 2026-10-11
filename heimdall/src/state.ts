// Sessions (saved to disk, so they survive restarts) and login throttling (in memory).
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { USERS, type User } from "./users.js";

export const MAX_ATTEMPTS = 3;
export const LOCKOUT_MS = 5 * 60_000;
/** Users must log in again this long after logging in, however active they are. */
export const SESSION_TTL_MS = 14 * 24 * 60 * 60_000;

// ---- Sessions -------------------------------------------------------------

// systemd sets STATE_DIRECTORY (/var/lib/heimdall); locally it falls back to ./data.
const STATE_DIR = process.env.STATE_DIRECTORY ?? "data";
const SESSIONS_FILE = join(STATE_DIR, "sessions.json");

interface StoredSession {
  username: string;
  /** Fingerprint of the user's password hash at login; see credentialStamp(). */
  stamp: string;
  loginAt: number;
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

/** The session's user, if the session hasn't expired and their credentials are unchanged. */
function currentUser(stored: StoredSession): User | null {
  if (stored.expiresAt <= Date.now()) return null;
  const user = USERS.find((u) => u.username === stored.username);
  return user && stored.stamp === credentialStamp(user) ? user : null;
}

function loadSessions(): Map<string, StoredSession> {
  try {
    const entries = JSON.parse(readFileSync(SESSIONS_FILE, "utf8")) as [string, StoredSession][];
    const valid = entries.filter(([, s]) => currentUser(s));
    const dropped = entries.length - valid.length;
    if (dropped > 0) console.log(`[heimdall] dropped ${dropped} saved session(s): expired, user removed or credentials changed`);
    return new Map(valid);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[heimdall] could not read saved sessions, starting with none:", err);
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
    console.error("[heimdall] could not save sessions:", err);
  }
}

export function createSession(user: User): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  sessions.set(tokenKey(token), { username: user.username, stamp: credentialStamp(user), loginAt: now, expiresAt });
  saveSessions();
  return { token, expiresAt };
}

export function getSession(token: string | undefined): Session | null {
  if (!token) return null;
  const key = tokenKey(token);
  const stored = sessions.get(key);
  if (!stored) return null;
  const user = currentUser(stored);
  if (!user) {
    if (stored.expiresAt > Date.now()) {
      console.log(`[heimdall] ended a session for ${stored.username}: user removed or credentials changed`);
    }
    sessions.delete(key);
    saveSessions();
    return null;
  }
  return { ...stored, name: user.name };
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

// Drop expired sessions and stale attempt records so memory stays bounded.
setInterval(() => {
  const now = Date.now();
  let expired = false;
  for (const [key, s] of sessions) {
    if (s.expiresAt <= now) expired = sessions.delete(key);
  }
  if (expired) saveSessions();
  for (const [key, r] of attempts) {
    if (r.lockedUntil <= now && now - r.lastFailure > LOCKOUT_MS) attempts.delete(key);
  }
}, 60_000).unref();
