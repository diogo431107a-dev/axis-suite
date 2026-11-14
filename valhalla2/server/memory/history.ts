// How much of the chat is sent.
//
// Only the selected path, and of that only the newest part, up to about a token budget. When the
// path outgrows it, the oldest exchanges slide out — several at once (`chunk`), not one per turn,
// because every slide changes the start of what is sent and so costs the cached prefix. Where the
// window starts is kept in `chats.window_start`, so every request until the next slide starts in
// the same place. Whatever slides out is folded into memory first (consolidate.ts), so it is not
// forgotten, only summarized.
import type { Message } from "../../shared/protocol.ts";
import { blockText } from "../../shared/protocol.ts";

/** A rough count of what a message costs to send: about four characters a token. */
export function tokensOf(message: Message): number {
  const text = message.content.map(blockText).join("") + (message.instruction ?? "");
  return Math.ceil(text.length / 4) + 8;
}

export interface Window {
  /** The index in the path of the first message sent. */
  from: number;
  /** That message's id, to keep; null when the window starts at the beginning. */
  startId: number | null;
  /** Whether this moved the start since last time. */
  slid: boolean;
}

/**
 * Where the window starts for this path. `stored` is where it started last time; a path that no
 * longer holds that message (you branched off above it) is measured again from the beginning.
 * The window always starts at one of your messages, and the newest two exchanges always stay.
 */
export function windowFor(path: Message[], stored: number | null, budget: number, chunk: number): Window {
  let from =
    stored === null
      ? 0
      : Math.max(
          0,
          path.findIndex((message) => message.id === stored),
        );
  const total = (at: number) => path.slice(at).reduce((sum, message) => sum + tokensOf(message), 0);
  const latest = Math.max(0, path.length - 4);
  while (total(from) > budget) {
    let next = Math.min(from + chunk * 2, latest);
    while (next < latest && path[next]?.role !== "user") next++;
    if (next <= from || path[next]?.role !== "user") break;
    from = next;
  }
  const startId = from === 0 ? null : (path[from]?.id ?? null);
  return { from, startId, slid: startId !== stored };
}
