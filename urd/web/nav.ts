// Where the page is: every view has its own address, so Back and Forward work and History can be
// bookmarked. Caddy and Vite send every path to index.html. Copied from Papyrus, with Urd's views.
import { useEffect, useState } from "react";

export type Route = { kind: "timer" } | { kind: "history"; unnamed: boolean } | { kind: "projects" };

export function parseRoute(url: { pathname: string; search: string } = location): Route {
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "/history") return { kind: "history", unnamed: new URLSearchParams(url.search).get("unnamed") === "1" };
  if (path === "/projects") return { kind: "projects" };
  return { kind: "timer" };
}

export function pathOf(route: Route): string {
  switch (route.kind) {
    case "timer":
      return "/";
    case "history":
      return route.unnamed ? "/history?unnamed=1" : "/history";
    case "projects":
      return "/projects";
  }
}

const NAVIGATE = "urd:navigate";

/** Goes to a view, adding a history entry (or replacing the current one). */
export function go(route: Route, replace = false): void {
  const path = pathOf(route);
  if (path !== location.pathname + location.search) {
    if (replace) history.replaceState(null, "", path);
    else history.pushState(null, "", path);
  }
  window.dispatchEvent(new Event(NAVIGATE));
}

/** The view in the address bar, kept up to date. */
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
