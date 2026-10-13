// Rooms, IRC-style: people are in a room while they have Althing open, and a room nobody is in
// closes. Both wait GRACE_MS first, so a reload, a dropped connection or a server restart
// changes nothing.
import type { Store } from "./store.ts";

export const GRACE_MS = 60_000;

export interface PresenceOptions {
  /** Whether `username` has Althing open now. */
  isConnected: (username: string) => boolean;
  /** The list of open rooms, or who is in them, changed. */
  onRoomsChanged: () => void;
  graceMs?: number;
}

export function createPresence(store: Store, { isConnected, onRoomsChanged, graceMs = GRACE_MS }: PresenceOptions) {
  /** username → takes them out of every room */
  const leaving = new Map<string, NodeJS.Timeout>();
  /** room → closes it if it is still empty */
  const closing = new Map<number, NodeJS.Timeout>();

  function later(fn: () => void): NodeJS.Timeout {
    const timer = setTimeout(fn, graceMs);
    timer.unref();
    return timer;
  }

  function scheduleClose(roomId: number): void {
    if (closing.has(roomId)) return;
    closing.set(
      roomId,
      later(() => {
        closing.delete(roomId);
        if (store.closeIfEmpty(roomId)) onRoomsChanged();
      }),
    );
  }

  function cancelClose(roomId: number): void {
    clearTimeout(closing.get(roomId));
    closing.delete(roomId);
  }

  function scheduleLeave(username: string): void {
    if (leaving.has(username)) return;
    leaving.set(
      username,
      later(() => {
        leaving.delete(username);
        if (isConnected(username)) return;
        const rooms = store.leaveAllRooms(username);
        for (const id of rooms) if (store.members(id).length === 0) scheduleClose(id);
        if (rooms.length > 0) onRoomsChanged();
      }),
    );
  }

  return {
    /**
     * At start-up nobody is connected yet: everyone still in a room, and every empty room, gets the
     * grace period to come back.
     */
    start(): void {
      for (const username of store.peopleInRooms()) if (!isConnected(username)) scheduleLeave(username);
      for (const id of store.emptyRooms()) scheduleClose(id);
    },

    connected(username: string): void {
      clearTimeout(leaving.get(username));
      leaving.delete(username);
    },

    disconnected(username: string): void {
      scheduleLeave(username);
    },

    create(username: string, name: unknown): number {
      const id = store.createRoom(username, name);
      onRoomsChanged();
      if (!isConnected(username)) scheduleLeave(username);
      return id;
    },

    join(username: string, roomId: number): void {
      cancelClose(roomId);
      if (store.joinRoom(username, roomId)) onRoomsChanged();
      // Joined without a live connection: they still leave when the grace runs out.
      if (!isConnected(username)) scheduleLeave(username);
    },

    leave(username: string, roomId: number): void {
      if (!store.leaveRoom(username, roomId)) return;
      if (store.members(roomId).length === 0) scheduleClose(roomId);
      onRoomsChanged();
    },

    stop(): void {
      for (const timer of [...leaving.values(), ...closing.values()]) clearTimeout(timer);
      leaving.clear();
      closing.clear();
    },
  };
}
