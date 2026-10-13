// Where the page is: every conversation has its own address, so Back and Forward work and a room
// can be bookmarked. Caddy and Vite send every path to index.html.
//
//   /          the lobby
//   /r/<id>    a room
//   /d/<id>    a direct conversation
import { useEffect, useState } from "react";
import { LOBBY_ID, LOBBY_KEY, parseKey } from "../shared/protocol.ts";

/** The conversation key for a path; anything unknown is the lobby. */
export function keyOf(pathname: string = location.pathname): string {
  const m = /^\/([rd])\/(\d+)\/?$/.exec(pathname);
  const key = m ? `${m[1]}${m[2]}` : LOBBY_KEY;
  return parseKey(key) ? key : LOBBY_KEY;
}

export function pathOf(key: string): string {
  const conv = parseKey(key);
  if (!conv || (conv.kind === "room" && conv.id === LOBBY_ID)) return "/";
  return conv.kind === "room" ? `/r/${conv.id}` : `/d/${conv.id}`;
}

const NAVIGATE = "althing:navigate";

/** Opens a conversation, adding a history entry (or replacing the current one). */
export function go(key: string, replace = false): void {
  const path = pathOf(key);
  if (path === location.pathname) return;
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  window.dispatchEvent(new Event(NAVIGATE));
}

/** The conversation in the address bar, kept up to date. */
export function useRoute(): string {
  const [key, setKey] = useState(() => keyOf());
  useEffect(() => {
    const update = () => setKey(keyOf());
    window.addEventListener("popstate", update);
    window.addEventListener(NAVIGATE, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(NAVIGATE, update);
    };
  }, []);
  return key;
}

/** Whether a click should open the link the browser's way (new tab, …) rather than in the page. */
export const opensElsewhere = (e: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}) => e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
