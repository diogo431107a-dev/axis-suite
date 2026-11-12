// The format the server uses to report a reply as it is written, and the reader for it.
//
// A reply arrives as a text/event-stream: one JSON event per frame, frames separated by a blank
// line. The page can't use EventSource for it (that only does GET, and sending a message is a
// POST), so it reads the response body itself — and the two sides agree here, in one file.
import type { StreamEvent } from "./protocol.ts";

/** One event, as it goes on the wire. */
export const frame = (event: StreamEvent): string => `data: ${JSON.stringify(event)}\n\n`;

/**
 * Pulls events out of a stream that arrives in whatever pieces the network gives it. A frame
 * split across two chunks is held until the rest of it shows up.
 */
export function createFrameReader(): (chunk: string) => StreamEvent[] {
  let waiting = "";
  return (chunk: string): StreamEvent[] => {
    waiting += chunk;
    const parts = waiting.split("\n\n");
    // The last piece is whatever came after the final blank line: an unfinished frame, or "".
    waiting = parts.pop() ?? "";
    const events: StreamEvent[] = [];
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      events.push(JSON.parse(line.slice("data:".length).trim()) as StreamEvent);
    }
    return events;
  };
}
