// Who is online: everyone with a live Heimdall session, wherever they use the suite. Heimdall's
// GET /online answers only a signed-in caller, so Althing asks with the cookie of someone who
// has Althing open, every POLL_MS while anyone does. Asking doesn't keep that session open.
import type { Events } from "./events.ts";

export const POLL_MS = 15_000;

export interface OnlineOptions {
  /** Where this server reaches Heimdall. */
  internalUrl: string;
  events: Events;
  /** The set changed: everyone, sorted. */
  onChange: (online: string[]) => void;
  pollMs?: number;
  fetch?: typeof fetch;
}

export function createOnline({ internalUrl, events, onChange, pollMs = POLL_MS, fetch: get = fetch }: OnlineOptions) {
  let online: string[] = [];
  let running: Promise<void> | null = null;
  let again = false;

  /** Heimdall's list, or null if it can't say (unreachable, or an older Heimdall without /online). */
  async function askHeimdall(): Promise<string[] | null> {
    for (const cookie of events.cookies()) {
      let res: Response;
      try {
        res = await get(new URL("/online", internalUrl), {
          headers: { cookie },
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        return null;
      }
      if (res.status === 401) {
        // That person's session has ended: their tabs find out when they reconnect.
        events.endStreams(cookie);
        continue;
      }
      if (!res.ok) return null;
      const body = (await res.json().catch(() => null)) as { usernames?: unknown } | null;
      const list = body?.usernames;
      return Array.isArray(list) ? list.filter((u): u is string => typeof u === "string") : null;
    }
    return null;
  }

  async function poll(): Promise<void> {
    if (events.connected().length === 0) {
      online = [];
      return;
    }
    const heimdall = await askHeimdall();
    if (heimdall) {
      // Someone with Althing open but no session left has signed out: their tabs stop getting
      // messages now, and find out when they reconnect. (A tab opened during the question is
      // only asked to reconnect.)
      for (const username of events.connected()) if (!heimdall.includes(username)) events.endStreamsOf(username);
    }
    // Without Heimdall's answer, whoever has Althing open is signed in.
    const next = [...new Set([...(heimdall ?? []), ...events.connected()])].sort();
    if (next.join("\n") !== online.join("\n")) {
      online = next;
      onChange(online);
    }
  }

  /** Asks Heimdall now (once at a time; a request meanwhile asks again right after). */
  function refresh(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = poll()
      .catch((err: unknown) => console.error("Could not update who is online:", err))
      .finally(() => {
        running = null;
        if (again) {
          again = false;
          void refresh();
        }
      });
    return running;
  }

  const timer = setInterval(() => void refresh(), pollMs);
  timer.unref();

  return {
    refresh,
    current(): string[] {
      return online;
    },
    stop(): void {
      clearInterval(timer);
    },
  };
}
