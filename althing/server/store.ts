import type { DatabaseSync } from "node:sqlite";
import { isAvatar, randomAvatar } from "../shared/avatars.ts";
import {
  LIMITS,
  LOBBY_ID,
  dmKey,
  parseKey,
  roomKey,
  type Dm,
  type Message,
  type Person,
  type ProfileInput,
  type Room,
} from "../shared/protocol.ts";

// The only place the database is read and written. Messages are never changed or deleted (the
// database refuses it too, see db.ts); rooms close but stay.

/** A request the store refuses, with the HTTP status to answer. */
export class StoreError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** What the page shows for a removed user's name; nobody can take it as a nickname. */
export const DELETED_USER = "deleted user";

interface ProfileRow {
  username: string;
  nickname: string;
  about: string;
  avatar: string;
}

interface MessageRow {
  id: number;
  room_id: number | null;
  dm_id: number | null;
  author: string | null;
  body: string;
  created_at: string;
}

interface DmRow {
  id: number;
  user_a: string | null;
  user_b: string | null;
  last_id: number;
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conv: row.room_id !== null ? roomKey(row.room_id) : dmKey(row.dm_id!),
    author: row.author,
    body: row.body,
    createdAt: row.created_at,
  };
}

function toDm(row: DmRow, me: string): Dm {
  return { id: row.id, with: row.user_a === me ? row.user_b : row.user_a, lastId: row.last_id };
}

/** Characters that would break a line or hide text: control characters but tab and newline. */
// oxlint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g;

function chars(s: string): number {
  return [...s].length;
}

/** A one-line name: control characters and line breaks removed, spaces collapsed, trimmed. */
function cleanName(value: unknown): string {
  return typeof value === "string" ? value.replace(CONTROL, "").replace(/\s+/g, " ").trim() : "";
}

/** Several lines of text: control characters removed, Windows line ends made plain, trimmed. */
function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").replace(CONTROL, "").trim() : "";
}

export interface StoreOptions {
  now?: () => Date;
  random?: () => number;
}

export function createStore(db: DatabaseSync, { now = () => new Date(), random = Math.random }: StoreOptions = {}) {
  const stamp = () => now().toISOString();

  // ---- Profiles ----
  const profileRow = db.prepare("SELECT username, nickname, about, avatar FROM profiles WHERE username = ?");
  const allProfiles = db.prepare(
    "SELECT username, nickname, about, avatar FROM profiles ORDER BY nickname COLLATE NOCASE",
  );
  const nicknameOwner = db.prepare("SELECT username FROM profiles WHERE nickname = ? COLLATE NOCASE");
  const insertProfile = db.prepare("INSERT INTO profiles (username, nickname, avatar, created_at) VALUES (?, ?, ?, ?)");
  const updateProfileRow = db.prepare("UPDATE profiles SET nickname = ?, about = ?, avatar = ? WHERE username = ?");
  const setAvatar = db.prepare("UPDATE profiles SET avatar = ? WHERE username = ?");
  const welcomedRow = db.prepare("SELECT welcomed FROM profiles WHERE username = ?");
  const setWelcomedRow = db.prepare("UPDATE profiles SET welcomed = 1 WHERE username = ?");
  const insertNickname = db.prepare("INSERT INTO nicknames (username, nickname, from_at) VALUES (?, ?, ?)");

  // ---- Rooms ----
  const openRoomRows = db.prepare(
    `SELECT id, name FROM rooms WHERE closed_at IS NULL ORDER BY id = ${LOBBY_ID} DESC, name COLLATE NOCASE, id`,
  );
  const openMemberRows = db.prepare(
    `SELECT room_id, username FROM room_visits WHERE left_at IS NULL AND username IS NOT NULL
     ORDER BY username`,
  );
  const roomRow = db.prepare("SELECT id, name, closed_at FROM rooms WHERE id = ?");
  const openRoomCount = db.prepare("SELECT count(*) AS n FROM rooms WHERE closed_at IS NULL");
  const openRoomByName = db.prepare("SELECT id FROM rooms WHERE closed_at IS NULL AND name = ? COLLATE NOCASE");
  const insertRoom = db.prepare("INSERT INTO rooms (name, created_by, created_at) VALUES (?, ?, ?)");
  const closeRoomRow = db.prepare("UPDATE rooms SET closed_at = ? WHERE id = ? AND closed_at IS NULL");
  const memberRows = db.prepare(
    "SELECT username FROM room_visits WHERE room_id = ? AND left_at IS NULL AND username IS NOT NULL ORDER BY username",
  );
  const isMemberRow = db.prepare(
    "SELECT 1 AS yes FROM room_visits WHERE room_id = ? AND username = ? AND left_at IS NULL",
  );
  const insertVisit = db.prepare("INSERT INTO room_visits (room_id, username, joined_at) VALUES (?, ?, ?)");
  const endVisit = db.prepare(
    "UPDATE room_visits SET left_at = ? WHERE room_id = ? AND username = ? AND left_at IS NULL",
  );
  const roomsOfRows = db.prepare(
    "SELECT DISTINCT room_id FROM room_visits WHERE username = ? AND left_at IS NULL ORDER BY room_id",
  );
  const peopleInRoomsRows = db.prepare(
    "SELECT DISTINCT username FROM room_visits WHERE left_at IS NULL AND username IS NOT NULL ORDER BY username",
  );
  const emptyOpenRoomRows = db.prepare(
    `SELECT id FROM rooms r WHERE closed_at IS NULL AND id <> ${LOBBY_ID}
       AND NOT EXISTS (SELECT 1 FROM room_visits v WHERE v.room_id = r.id AND v.left_at IS NULL
                       AND v.username IS NOT NULL)`,
  );

  // ---- Direct conversations ----
  const dmRow = db.prepare("SELECT id, user_a, user_b, 0 AS last_id FROM dms WHERE id = ?");
  const dmByPair = db.prepare("SELECT id, user_a, user_b, 0 AS last_id FROM dms WHERE user_a = ? AND user_b = ?");
  const insertDm = db.prepare("INSERT INTO dms (user_a, user_b, created_at) VALUES (?, ?, ?)");
  const dmsOfRows = db.prepare(
    `SELECT d.id, d.user_a, d.user_b, coalesce((SELECT max(id) FROM messages m WHERE m.dm_id = d.id), 0) AS last_id
     FROM dms d WHERE d.user_a = $me OR d.user_b = $me ORDER BY last_id DESC, d.id DESC`,
  );

  // ---- Messages ----
  const COLUMNS = "id, room_id, dm_id, author, body, created_at";
  const insertMessage = db.prepare(
    `INSERT INTO messages (room_id, dm_id, author, body, created_at) VALUES (?, ?, ?, ?, ?) RETURNING ${COLUMNS}`,
  );
  const roomPage = db.prepare(
    `SELECT * FROM (SELECT ${COLUMNS} FROM messages WHERE room_id = ? AND id < ? ORDER BY id DESC LIMIT ?)
     ORDER BY id`,
  );
  const dmPage = db.prepare(
    `SELECT * FROM (SELECT ${COLUMNS} FROM messages WHERE dm_id = ? AND id < ? ORDER BY id DESC LIMIT ?)
     ORDER BY id`,
  );
  const lastRoomMessage = db.prepare("SELECT coalesce(max(id), 0) AS id FROM messages WHERE room_id = ?");

  // ---- Reads ----
  const markReadRow = db.prepare(
    `INSERT INTO reads (owner, conv, last_id) VALUES (?, ?, ?)
     ON CONFLICT (owner, conv) DO UPDATE SET last_id = max(last_id, excluded.last_id)`,
  );
  // At most 100 are counted: the page shows "99+".
  const unreadInRoom = db.prepare(
    `SELECT count(*) AS n FROM (SELECT 1 FROM messages WHERE room_id = $room AND author IS NOT $me
       AND id > coalesce((SELECT last_id FROM reads WHERE owner = $me AND conv = $conv), 0) LIMIT 100)`,
  );
  const unreadInDm = db.prepare(
    `SELECT count(*) AS n FROM (SELECT 1 FROM messages WHERE dm_id = $dm AND author IS NOT $me
       AND id > coalesce((SELECT last_id FROM reads WHERE owner = $me AND conv = $conv), 0) LIMIT 100)`,
  );

  // ---- Removed users ----
  // $known: a JSON array of usernames. NULL (already removed) is never "unknown".
  const UNKNOWN = (column: string) => `${column} NOT IN (SELECT value FROM json_each($known))`;
  const unknownUsers = db.prepare(`
    SELECT username, (SELECT count(*) FROM messages m WHERE m.author = u.username) AS messages FROM (
      SELECT username FROM profiles WHERE ${UNKNOWN("username")}
      UNION SELECT author FROM messages WHERE ${UNKNOWN("author")}
      UNION SELECT username FROM room_visits WHERE ${UNKNOWN("username")}
      UNION SELECT user_a FROM dms WHERE ${UNKNOWN("user_a")}
      UNION SELECT user_b FROM dms WHERE ${UNKNOWN("user_b")}
      UNION SELECT created_by FROM rooms WHERE ${UNKNOWN("created_by")}
      UNION SELECT username FROM nicknames WHERE ${UNKNOWN("username")}
      UNION SELECT owner FROM reads WHERE ${UNKNOWN("owner")}
    ) u ORDER BY username`);
  // A removed user leaves every room they were still in.
  const endUnknownVisits = db.prepare(
    `UPDATE room_visits SET left_at = $now WHERE left_at IS NULL AND ${UNKNOWN("username")}`,
  );
  const forgetUnknown = [
    `UPDATE messages SET author = NULL WHERE ${UNKNOWN("author")}`,
    `UPDATE room_visits SET username = NULL WHERE ${UNKNOWN("username")}`,
    `UPDATE dms SET user_a = NULL WHERE ${UNKNOWN("user_a")}`,
    `UPDATE dms SET user_b = NULL WHERE ${UNKNOWN("user_b")}`,
    `UPDATE rooms SET created_by = NULL WHERE ${UNKNOWN("created_by")}`,
    `DELETE FROM profiles WHERE ${UNKNOWN("username")}`,
    `DELETE FROM nicknames WHERE ${UNKNOWN("username")}`,
    `DELETE FROM reads WHERE ${UNKNOWN("owner")}`,
  ].map((sql) => db.prepare(sql));

  /** Runs `fn` in one transaction. */
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

  function profile(username: string): Person | null {
    return (profileRow.get(username) as ProfileRow | undefined) ?? null;
  }

  function requireProfile(username: string): Person {
    const p = profile(username);
    if (!p) throw new StoreError(404, "There is nobody by that name in Althing");
    return p;
  }

  function openRoom(id: number): { id: number; name: string } {
    const row = roomRow.get(id) as { id: number; name: string; closed_at: string | null } | undefined;
    if (!row || row.closed_at !== null) throw new StoreError(404, "This room has closed");
    return row;
  }

  function isMember(username: string, roomId: number): boolean {
    return roomId === LOBBY_ID || isMemberRow.get(roomId, username) !== undefined;
  }

  function members(roomId: number): string[] {
    return (memberRows.all(roomId) as { username: string }[]).map((r) => r.username);
  }

  /** The two people of a direct conversation, if `username` is one of them. */
  function dmFor(username: string, id: number): DmRow {
    const row = dmRow.get(id) as unknown as DmRow | undefined;
    if (!row || (row.user_a !== username && row.user_b !== username)) {
      throw new StoreError(404, "There is no such conversation");
    }
    return row;
  }

  return {
    // ---- Profiles ----

    profile,

    /**
     * The user's profile, made on their first visit (or when the server first hears of them): their
     * username as nickname (with a number if someone already took it) and a random picture. Returns
     * whether it was just made.
     */
    ensureProfile(username: string): { person: Person; created: boolean } {
      const existing = profile(username);
      if (existing) return { person: existing, created: false };
      return transaction(() => {
        let nickname = username;
        for (let n = 2; nicknameOwner.get(nickname) || nickname.toLowerCase() === DELETED_USER; n++) {
          nickname = `${username}${n}`;
        }
        const at = stamp();
        insertProfile.run(username, nickname, randomAvatar(random), at);
        insertNickname.run(username, nickname, at);
        // The lobby's past isn't news to someone who just arrived.
        const { id } = lastRoomMessage.get(LOBBY_ID) as { id: number };
        markReadRow.run(username, roomKey(LOBBY_ID), id);
        return { person: profile(username)!, created: true };
      });
    },

    people(): Person[] {
      return allProfiles.all() as unknown as ProfileRow[];
    },

    welcomed(username: string): boolean {
      return (welcomedRow.get(username) as { welcomed: number } | undefined)?.welcomed === 1;
    },

    setWelcomed(username: string): void {
      setWelcomedRow.run(username);
    },

    updateProfile(username: string, input: Partial<ProfileInput>): Person {
      const current = requireProfile(username);
      const nickname = cleanName(input?.nickname);
      const about = cleanText(input?.about);
      const avatar = typeof input?.avatar === "string" ? input.avatar : "";
      const n = chars(nickname);
      if (n < LIMITS.nicknameMinChars || n > LIMITS.nicknameChars) {
        throw new StoreError(400, `A nickname has ${LIMITS.nicknameMinChars} to ${LIMITS.nicknameChars} characters`);
      }
      if (nickname.toLowerCase() === DELETED_USER) throw new StoreError(409, "That nickname is reserved");
      if (chars(about) > LIMITS.aboutChars) {
        throw new StoreError(400, `"About me" has at most ${LIMITS.aboutChars} characters`);
      }
      if (!isAvatar(avatar)) throw new StoreError(400, "Pick one of the pictures");
      return transaction(() => {
        const owner = nicknameOwner.get(nickname) as { username: string } | undefined;
        if (owner && owner.username !== username) throw new StoreError(409, "Someone already has that nickname");
        updateProfileRow.run(nickname, about, avatar, username);
        if (nickname !== current.nickname) insertNickname.run(username, nickname, stamp());
        return profile(username)!;
      });
    },

    /** Gives a new random picture to everyone whose picture is no longer in the set. Returns how many. */
    fixAvatars(): number {
      let fixed = 0;
      for (const p of allProfiles.all() as unknown as ProfileRow[]) {
        if (!isAvatar(p.avatar)) {
          setAvatar.run(randomAvatar(random), p.username);
          fixed++;
        }
      }
      return fixed;
    },

    // ---- Rooms ----

    /** The lobby, then every open room by name, each with the people in it now. */
    rooms(): Room[] {
      const byRoom = new Map<number, string[]>();
      for (const { room_id, username } of openMemberRows.all() as { room_id: number; username: string }[]) {
        let list = byRoom.get(room_id);
        if (!list) byRoom.set(room_id, (list = []));
        list.push(username);
      }
      return (openRoomRows.all() as { id: number; name: string }[]).map((r) => ({
        id: r.id,
        name: r.name,
        members: byRoom.get(r.id) ?? [],
      }));
    },

    /** Opens a room, with its creator in it. Returns its id. */
    createRoom(username: string, input: unknown): number {
      const name = cleanName((input as { name?: unknown } | null)?.name);
      if (name === "" || chars(name) > LIMITS.roomNameChars) {
        throw new StoreError(400, `A room's name has 1 to ${LIMITS.roomNameChars} characters`);
      }
      return transaction(() => {
        if (openRoomByName.get(name)) throw new StoreError(409, "A room by that name is open; join it instead");
        if ((openRoomCount.get() as { n: number }).n > LIMITS.rooms) {
          throw new StoreError(409, "Too many rooms are open. Join one of them instead");
        }
        const at = stamp();
        const id = Number(insertRoom.run(name, username, at).lastInsertRowid);
        insertVisit.run(id, username, at);
        return id;
      });
    },

    /** Puts the user in an open room. False if they already were. */
    joinRoom(username: string, roomId: number): boolean {
      if (roomId === LOBBY_ID) return false;
      return transaction(() => {
        openRoom(roomId);
        if (isMember(username, roomId)) return false;
        insertVisit.run(roomId, username, stamp());
        // What was said before they came in is there to read, but not unread.
        const { id } = lastRoomMessage.get(roomId) as { id: number };
        markReadRow.run(username, roomKey(roomId), id);
        return true;
      });
    },

    /** Takes the user out of a room. False if they weren't in it. */
    leaveRoom(username: string, roomId: number): boolean {
      return endVisit.run(stamp(), roomId, username).changes > 0;
    },

    /** Takes the user out of every room. Returns the rooms they were in. */
    leaveAllRooms(username: string): number[] {
      return transaction(() => {
        const rooms = (roomsOfRows.all(username) as { room_id: number }[]).map((r) => r.room_id);
        const at = stamp();
        for (const id of rooms) endVisit.run(at, id, username);
        return rooms;
      });
    },

    members,
    isMember,

    /** Everyone who is in at least one room. */
    peopleInRooms(): string[] {
      return (peopleInRoomsRows.all() as { username: string }[]).map((r) => r.username);
    },

    /** Open rooms with nobody in them (never the lobby). */
    emptyRooms(): number[] {
      return (emptyOpenRoomRows.all() as { id: number }[]).map((r) => r.id);
    },

    /** Closes a room if nobody is in it. It stays in the database, messages and all. */
    closeIfEmpty(roomId: number): boolean {
      if (roomId === LOBBY_ID) return false;
      return transaction(() => members(roomId).length === 0 && closeRoomRow.run(stamp(), roomId).changes > 0);
    },

    // ---- Direct conversations ----

    /** The direct conversation between the user and `other`, started if it is new. */
    openDm(username: string, other: unknown): Dm {
      if (typeof other !== "string" || other === username) {
        throw new StoreError(400, "Pick someone else to write to");
      }
      requireProfile(other);
      const [a, b] = username < other ? [username, other] : [other, username];
      return transaction(() => {
        let row = dmByPair.get(a, b) as unknown as DmRow | undefined;
        if (!row) {
          insertDm.run(a, b, stamp());
          row = dmByPair.get(a, b) as unknown as DmRow;
        }
        return toDm(row, username);
      });
    },

    /** The user's direct conversations, newest first. */
    dms(username: string): Dm[] {
      return (dmsOfRows.all({ $me: username }) as unknown as DmRow[]).map((r) => toDm(r, username));
    },

    // ---- Messages ----

    /**
     * Who gets a conversation's new messages live: everyone for the lobby, the people in a room,
     * or the two people of a direct conversation.
     */
    audience(key: string): string[] | "everyone" {
      const conv = parseKey(key);
      if (!conv) return [];
      if (conv.kind === "room") return conv.id === LOBBY_ID ? "everyone" : members(conv.id);
      const row = dmRow.get(conv.id) as unknown as DmRow | undefined;
      return row ? [row.user_a, row.user_b].filter((u) => u !== null) : [];
    },

    /** Saves a message. Only people in a room (everyone, in the lobby) can write there. */
    post(username: string, key: string, input: unknown): Message {
      const conv = parseKey(key);
      if (!conv) throw new StoreError(404, "There is no such conversation");
      const body = cleanText((input as { body?: unknown } | null)?.body);
      if (body === "") throw new StoreError(400, "The message is empty");
      if (chars(body) > LIMITS.messageChars) {
        throw new StoreError(400, `A message has at most ${LIMITS.messageChars} characters`);
      }
      return transaction(() => {
        let row: MessageRow;
        if (conv.kind === "room") {
          openRoom(conv.id);
          if (!isMember(username, conv.id)) throw new StoreError(403, "Join the room to write in it");
          row = insertMessage.get(conv.id, null, username, body, stamp()) as unknown as MessageRow;
        } else {
          const dm = dmFor(username, conv.id);
          if (dm.user_a === null || dm.user_b === null) {
            throw new StoreError(403, "This person is no longer in Althing");
          }
          row = insertMessage.get(null, conv.id, username, body, stamp()) as unknown as MessageRow;
        }
        markReadRow.run(username, key, row.id);
        return toMessage(row);
      });
    },

    /** Up to a page of a conversation's messages before `before` (none: the latest), oldest first. */
    history(username: string, key: string, before?: number): Message[] {
      const conv = parseKey(key);
      if (!conv) throw new StoreError(404, "There is no such conversation");
      const below = before && Number.isSafeInteger(before) && before > 0 ? before : Number.MAX_SAFE_INTEGER;
      let rows: MessageRow[];
      if (conv.kind === "room") {
        openRoom(conv.id);
        if (!isMember(username, conv.id)) throw new StoreError(403, "Join the room to read it");
        rows = roomPage.all(conv.id, below, LIMITS.page) as unknown as MessageRow[];
      } else {
        dmFor(username, conv.id);
        rows = dmPage.all(conv.id, below, LIMITS.page) as unknown as MessageRow[];
      }
      return rows.map(toMessage);
    },

    // ---- Unread counts ----

    /** Records that the user has seen a conversation up to message `id`. */
    markRead(username: string, key: string, id: unknown): void {
      if (!parseKey(key) || typeof id !== "number" || !Number.isSafeInteger(id) || id < 0) {
        throw new StoreError(400, "Not a conversation and message");
      }
      markReadRow.run(username, key, id);
    },

    /** Unread messages per conversation: the lobby, the user's rooms and their direct conversations. */
    unread(username: string): Record<string, number> {
      const counts: Record<string, number> = {};
      const rooms = [LOBBY_ID, ...(roomsOfRows.all(username) as { room_id: number }[]).map((r) => r.room_id)];
      for (const id of rooms) {
        const key = roomKey(id);
        const { n } = unreadInRoom.get({ $room: id, $me: username, $conv: key }) as { n: number };
        if (n > 0) counts[key] = n;
      }
      for (const dm of dmsOfRows.all({ $me: username }) as unknown as DmRow[]) {
        const key = dmKey(dm.id);
        const { n } = unreadInDm.get({ $dm: dm.id, $me: username, $conv: key }) as { n: number };
        if (n > 0) counts[key] = n;
      }
      return counts;
    },

    // ---- Removed users ----

    /**
     * Forgets every user who isn't in `known` (Heimdall's usernames), i.e. who was removed from
     * Heimdall: their profile, nickname history and unread counts go, and their username becomes
     * NULL wherever it appears. What they wrote stays, as a "deleted user". Returns who was
     * forgotten and how many messages they had written.
     */
    removeUnknownOwners(known: ReadonlySet<string>): { username: string; messages: number }[] {
      const $known = JSON.stringify([...known]);
      return transaction(() => {
        const removed = unknownUsers.all({ $known }) as { username: string; messages: number }[];
        if (removed.length > 0) {
          endUnknownVisits.run({ $known, $now: stamp() });
          for (const statement of forgetUnknown) statement.run({ $known });
        }
        return removed;
      });
    },
  };
}

export type Store = ReturnType<typeof createStore>;
