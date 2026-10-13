// Where the page is: every board has its own address, so Back and Forward work and a board or a
// card can be bookmarked. Caddy and Vite send every path to index.html.
//
//   /                 the last board opened (or, with none, a place to make one)
//   /b/<id>           a board              …?card=<id>   with a card open
import { useEffect, useState } from "react";

export interface Route {
  boardId: string | null;
  cardId: string | null;
}

export const HOME: Route = { boardId: null, cardId: null };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRoute(url: { pathname: string; search: string } = location): Route {
  const path = url.pathname.replace(/\/+$/, "");
  const board = path.startsWith("/b/") ? path.slice(3) : "";
  const card = new URLSearchParams(url.search).get("card") ?? "";
  return {
    boardId: ID.test(board) ? board.toLowerCase() : null,
    cardId: ID.test(board) && ID.test(card) ? card.toLowerCase() : null,
  };
}

export function pathOf(route: Route): string {
  if (!route.boardId) return "/";
  const path = `/b/${route.boardId}`;
  return route.cardId ? `${path}?${new URLSearchParams({ card: route.cardId })}` : path;
}

const NAVIGATE = "valkyrie:navigate";

/** Goes to a board or card, adding a history entry (or replacing the current one). */
export function go(route: Route, replace = false): void {
  const path = pathOf(route);
  if (path === location.pathname + location.search) return;
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  window.dispatchEvent(new Event(NAVIGATE));
}

/** The route in the address bar, kept up to date. */
export function useRoute(): Route {
  const [route, setRoute] = useState(parseRoute);
  useEffect(() => {
    const update = () => setRoute(parseRoute());
    window.addEventListener("popstate", update);
    window.addEventListener(NAVIGATE, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(NAVIGATE, update);
    };
  }, []);
  return route;
}

/** Whether a click should open the link the browser's way (new tab, …) rather than in the page. */
export const opensElsewhere = (e: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}) => e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
