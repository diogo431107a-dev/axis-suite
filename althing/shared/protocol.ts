// The API's wire format: what the server sends and accepts, and the limits it enforces.
// Uses no Node or DOM APIs, so both the server and the page import it.
//
// A conversation is named by a key: "r<id>" for the lobby or a room, "d<id>" for a direct
// conversation between two people. Message ids grow over time across every conversation.

/** Sent with every request: the user the page belongs to. The API answers 409 if someone else is signed in. */
export const USER_HEADER = "X-Althing-User";

/** The lobby is room 1. It is always open and everyone is in it. */
export const LOBBY_ID = 1;
export const LOBBY_KEY = `r${LOBBY_ID}`;

export const LIMITS = {
  messageChars: 2000,
  nicknameMinChars: 2,
  nicknameChars: 24,
  aboutChars: 500,
  roomNameChars: 40,
  /** open rooms at once */
  rooms: 100,
  /** messages per page of history */
  page: 50,
  /** at most this many messages per person… */
  burst: 10,
  /** …in this many milliseconds */
  burstMs: 10_000,
} as const;

export type ErrorCode = "other-user" | "too-fast";

export interface ApiError {
  error: string;
  code?: ErrorCode;
}

export interface Person {
  username: string;
  nickname: string;
  about: string;
  /** a file name in /avatars/ */
  avatar: string;
}

export interface Room {
  id: number;
  name: string;
  /** usernames of the people in it now, sorted */
  members: string[];
}

export interface Dm {
  id: number;
  /** the other person, or null once they were removed from the suite */
  with: string | null;
  /** id of the latest message, 0 if none */
  lastId: number;
}

export interface Message {
  id: number;
  conv: string;
  /** null once the author was removed from the suite: "deleted user" */
  author: string | null;
  body: string;
  /** ISO 8601, UTC */
  createdAt: string;
}

/** Everything the page needs to start, and again after its live connection drops. */
export interface ChatState {
  me: Person;
  /** false until the person has seen the welcome (with the rule about personal information) */
  welcomed: boolean;
  /** everyone in Althing, the signed-in user included */
  people: Person[];
  /** usernames with a live Heimdall session */
  online: string[];
  /** the lobby first, then every open room by name */
  rooms: Room[];
  /** newest conversation first */
  dms: Dm[];
  /** unread messages per conversation key, for the lobby, the user's rooms and their DMs */
  unread: Record<string, number>;
}

export interface ProfileInput {
  nickname: string;
  about: string;
  avatar: string;
}

/** Live updates, as server-sent events: the event name and its data. */
export interface EventMap {
  message: Message;
  rooms: Room[];
  online: string[];
  person: Person;
}

export function roomKey(id: number): string {
  return `r${id}`;
}

export function dmKey(id: number): string {
  return `d${id}`;
}

/** Splits a conversation key, or null if it isn't one. */
export function parseKey(key: string): { kind: "room" | "dm"; id: number } | null {
  const m = /^([rd])([1-9]\d{0,15})$/.exec(key);
  return m ? { kind: m[1] === "r" ? "room" : "dm", id: Number(m[2]) } : null;
}
