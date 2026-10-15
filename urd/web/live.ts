// The page's live connection: GET /api/events (server-sent events), as in Althing. The browser
// reconnects by itself after a dropped connection; if the server refuses the stream (signed out,
// or someone else signed in), it asks /api/me why. A stream that goes silent is replaced.
import { SignedOutError, fetchMe } from "@axis-suite/heimdall-client/browser";
import type { EventMap } from "../shared/protocol.ts";

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;
/** The server pings every 25 seconds; a stream silent for this long is dead (e.g. a proxy lost it). */
const SILENCE_MS = 70_000;
const NAMES = ["changed"] as const satisfies readonly (keyof EventMap)[];

export interface LiveHandlers {
  /** The user's sessions or projects changed, here or on another device. */
  onChanged: () => void;
  /** Connected again after a break: changes may have been missed. */
  onReconnect: () => void;
  onSignedOut: (loginUrl: string) => void;
  onOtherUser: () => void;
}

/** Starts listening. Returns a function that stops. */
export function listen(username: string, handlers: LiveHandlers): () => void {
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retry = RETRY_MIN_MS;
  let opened = false;
  let stopped = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;

  /** Something arrived: the stream works. If nothing more does for a while, start a new one. */
  function alive(): void {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      source?.close();
      source = null;
      connect();
    }, SILENCE_MS);
  }

  function connect(): void {
    clearTimeout(timer);
    if (stopped) return;
    const s = new EventSource(`/api/events?user=${encodeURIComponent(username)}`);
    source = s;
    s.addEventListener("open", () => {
      retry = RETRY_MIN_MS;
      alive();
      if (opened) handlers.onReconnect();
      opened = true;
    });
    s.addEventListener("ping", alive);
    for (const name of NAMES) {
      s.addEventListener(name, () => {
        alive();
        handlers.onChanged();
      });
    }
    s.addEventListener("error", () => {
      // CONNECTING: the browser retries by itself. CLOSED: the server refused the stream.
      if (s.readyState !== EventSource.CLOSED) return;
      clearTimeout(watchdog);
      s.close();
      source = null;
      if (stopped) return;
      const again = () => {
        timer = setTimeout(connect, retry);
        retry = Math.min(RETRY_MAX_MS, retry * 2);
      };
      fetchMe()
        .then((me) => (me.username === username ? again() : handlers.onOtherUser()))
        .catch((err: unknown) => (err instanceof SignedOutError ? handlers.onSignedOut(err.loginUrl) : again()));
    });
  }

  connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    clearTimeout(watchdog);
    source?.close();
  };
}
