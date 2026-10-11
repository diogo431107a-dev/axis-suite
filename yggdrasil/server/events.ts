// Live updates: each open tab keeps a GET /api/events stream (server-sent events), and every
// saved batch is announced to all the tabs of its user. One process serves everyone, so the
// streams are simply kept in memory.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RevEvent } from "../shared/protocol.ts";

/** A comment line keeps proxies and browsers from closing a quiet stream. */
const HEARTBEAT_MS = 25_000;
/** Streams are closed after this long, so the browser reconnects and Heimdall is asked again. */
const MAX_STREAM_MS = 10 * 60_000;

export function createEvents() {
  const streams = new Map<string, Set<ServerResponse>>();

  const heartbeat = setInterval(() => {
    for (const set of streams.values()) for (const res of set) res.write(": ping\n\n");
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
        if (set.size === 0 && streams.get(username) === set) streams.delete(username);
      });
    },

    /** Tells every open tab of `username` that their tree changed. */
    publish(username: string, event: RevEvent): void {
      const message = `event: rev\ndata: ${JSON.stringify(event)}\n\n`;
      for (const res of streams.get(username) ?? []) res.write(message);
    },

    /** Ends every stream, so the server can shut down. */
    closeAll(): void {
      clearInterval(heartbeat);
      for (const set of streams.values()) for (const res of set) res.end();
      streams.clear();
    },
  };
}
