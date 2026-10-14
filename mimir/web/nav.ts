// Where the page is: every map has its own address, so Back and Forward work and a map (or one
// node in it) can be bookmarked. Caddy and Vite send every path to index.html.
//
//   /                 the last map opened (or, with none, a place to make one)
//   /m/<id>           a map              …?node=<id>   with that node selected and centred
import { useEffect, useState } from "react";

export interface Route {
  mapId: string | null;
  nodeId: string | null;
}

export const HOME: Route = { mapId: null, nodeId: null };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRoute(url: { pathname: string; search: string } = location): Route {
  const path = url.pathname.replace(/\/+$/, "");
  const map = path.startsWith("/m/") ? path.slice(3) : "";
  const node = new URLSearchParams(url.search).get("node") ?? "";
  return {
    mapId: ID.test(map) ? map.toLowerCase() : null,
    nodeId: ID.test(map) && ID.test(node) ? node.toLowerCase() : null,
  };
}

export function pathOf(route: Route): string {
  if (!route.mapId) return "/";
  const path = `/m/${route.mapId}`;
  return route.nodeId ? `${path}?${new URLSearchParams({ node: route.nodeId })}` : path;
}

const NAVIGATE = "mimir:navigate";

/** Goes to a map (or a node in it), adding a history entry (or replacing the current one). */
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
