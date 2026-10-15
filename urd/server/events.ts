// Live updates: each open tab keeps a GET /api/events stream (server-sent events), and every change
// to a user's sessions or projects is announced to all their tabs, on any device. One process
// serves everyone, so the streams are simply kept in memory. Copied from Althing's, without who is
// online.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { EventMap } from "../shared/protocol.ts";

/**
 * A "ping" event keeps proxies and browsers from closing a quiet stream, and tells the page the
 * stream still works: one that stays silent much longer is dead, and the page reconnects.
 */
const HEARTBEAT_MS = 25_000;
/** Streams are closed after this long, so the browser reconnects and Heimdall is asked again. */
const MAX_STREAM_MS = 10 * 60_000;

export function createEvents() {
  const streams = new Map<string, Set<ServerResponse>>();

  function writeAll(set: Iterable<ServerResponse>, message: string): void {
    // A stream ended a moment ago may still be listed; writing to it would throw.
    for (const res of set) if (!res.writableEnded) res.write(message);
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

      let set = streams.get(username);
      if (!set) streams.set(username, (set = new Set()));
      set.add(res);

      const timer = setTimeout(() => res.end(), MAX_STREAM_MS);
      req.on("close", () => {
        clearTimeout(timer);
        set.delete(res);
        if (set.size === 0) streams.delete(username);
      });
    },

    /** Sends an event to every open tab of these users. */
    send<K extends keyof EventMap>(to: Iterable<string>, name: K, data: EventMap[K]): void {
      const message = `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const username of to) writeAll(streams.get(username) ?? [], message);
    },

    /** Ends every stream, so the server can shut down. */
    closeAll(): void {
      clearInterval(heartbeat);
      for (const set of streams.values()) for (const res of set) res.end();
      streams.clear();
    },
  };
}

export type Events = ReturnType<typeof createEvents>;
