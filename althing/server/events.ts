// Live updates: each open tab keeps a GET /api/events stream (server-sent events). One process
// serves everyone, so the streams are simply kept in memory. Copied from Yggdrasil's, plus: who
// is connected (for rooms), and each stream's cookie (for asking Heimdall who is online).
import type { IncomingMessage, ServerResponse } from "node:http";
import type { EventMap } from "../shared/protocol.ts";

/**
 * A "ping" event keeps proxies and browsers from closing a quiet stream, and tells the page the
 * stream still works: one that stays silent much longer is dead, and the page reconnects.
 */
const HEARTBEAT_MS = 25_000;
/** Streams are closed after this long, so the browser reconnects and Heimdall is asked again. */
const MAX_STREAM_MS = 10 * 60_000;

interface Stream {
  username: string;
  res: ServerResponse;
  /** the browser's Cookie header, for asking Heimdall on its behalf */
  cookie: string;
}

export interface EventsOptions {
  /** `username` opened their first tab. */
  onConnect?: (username: string) => void;
  /** `username` closed their last tab (or it lost its connection). */
  onDisconnect?: (username: string) => void;
}

export function createEvents({ onConnect, onDisconnect }: EventsOptions = {}) {
  const streams = new Map<string, Set<Stream>>();

  function writeAll(set: Iterable<Stream>, message: string): void {
    // A stream ended a moment ago may still be listed; writing to it would throw.
    for (const s of set) if (!s.res.writableEnded) s.res.write(message);
  }

  function write<K extends keyof EventMap>(set: Iterable<Stream>, name: K, data: EventMap[K]): void {
    writeAll(set, `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  /** Forgets a stream (once: ending it and its closing both get here). A user's last one disconnects them. */
  function drop(stream: Stream): void {
    const set = streams.get(stream.username);
    if (!set?.delete(stream)) return;
    if (set.size === 0) {
      streams.delete(stream.username);
      onDisconnect?.(stream.username);
    }
  }

  /** Ends a stream from this side. */
  function end(stream: Stream): void {
    drop(stream);
    stream.res.end();
  }

  const heartbeat = setInterval(() => {
    for (const set of streams.values()) writeAll(set, "event: ping\ndata: 1\n\n");
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return {
    /** Keeps `res` open as `username`'s event stream until either side closes it. */
    subscribe(username: string, req: IncomingMessage, res: ServerResponse): void {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        // Proxies such as nginx otherwise buffer the stream.
        "X-Accel-Buffering": "no",
      });
      // How long the browser waits before reconnecting after the stream ends.
      res.write("retry: 2000\n\n");

      const stream: Stream = { username, res, cookie: req.headers.cookie ?? "" };
      let set = streams.get(username);
      const first = !set;
      if (!set) streams.set(username, (set = new Set()));
      set.add(stream);
      if (first) onConnect?.(username);

      const timer = setTimeout(() => end(stream), MAX_STREAM_MS);
      req.on("close", () => {
        clearTimeout(timer);
        drop(stream);
      });
    },

    /** Sends an event to every open tab of these users, or of everyone. */
    send<K extends keyof EventMap>(to: Iterable<string> | "everyone", name: K, data: EventMap[K]): void {
      if (to === "everyone") {
        for (const set of streams.values()) write(set, name, data);
      } else {
        for (const username of to) write(streams.get(username) ?? [], name, data);
      }
    },

    /** Whether `username` has a tab open. */
    isConnected(username: string): boolean {
      return streams.has(username);
    },

    /** Everyone with a tab open. */
    connected(): string[] {
      return [...streams.keys()];
    },

    /** The Cookie header of each open stream, without repeats. */
    cookies(): string[] {
      const all = new Set<string>();
      for (const set of streams.values()) for (const s of set) if (s.cookie) all.add(s.cookie);
      return [...all];
    },

    /** Ends the streams opened with this cookie (its session has ended). Their pages find out on reconnecting. */
    endStreams(cookie: string): void {
      for (const set of [...streams.values()]) for (const s of [...set]) if (s.cookie === cookie) end(s);
    },

    /** Ends every stream of a user (who has signed out). */
    endStreamsOf(username: string): void {
      for (const s of [...(streams.get(username) ?? [])]) end(s);
    },

    /** Ends every stream, so the server can shut down. */
    closeAll(): void {
      clearInterval(heartbeat);
      for (const set of streams.values()) for (const s of set) s.res.end();
      streams.clear();
    },
  };
}

export type Events = ReturnType<typeof createEvents>;
