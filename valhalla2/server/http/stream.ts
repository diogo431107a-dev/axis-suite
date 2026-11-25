// A reply streamed to the page as it is written (server-sent events over a POST).
import type { Response } from "express";
import type { StreamEvent } from "../../shared/protocol.ts";
import { frame } from "../../shared/sse.ts";
import { asStoreError } from "../claude/client.ts";

// While Claude thinks, nothing is written for a while. A comment line now and then keeps every
// proxy in between from deciding the stream has gone quiet for good.
const HEARTBEAT_MS = 20_000;

/**
 * Answers with a reply as it is written. Everything that can be refused is checked before this
 * is called: once the stream headers go out the status can no longer change, so a failure has to
 * travel as an event instead.
 */
export async function stream(
  res: Response,
  release: () => void,
  work: (onEvent: (event: StreamEvent) => void) => Promise<void>,
): Promise<void> {
  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    // Nothing in between should sit on this and buffer it.
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  const tell = (event: StreamEvent) => {
    if (!res.writableEnded) res.write(frame(event));
  };
  tell({ type: "start" });
  // A line starting with ":" is a comment; the page's reader skips it.
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": still writing\n\n");
  }, HEARTBEAT_MS);
  try {
    await work(tell);
  } catch (err) {
    const failure = asStoreError(err);
    tell({ type: "error", error: failure.message, code: failure.code });
  } finally {
    clearInterval(heartbeat);
    release();
  }
  res.end();
}
