// Where the page is: every view has its own address, so Back and Forward work and a contact can be
// bookmarked. Caddy and Vite send every path to index.html.
//
//   /  /favorites  /g/<group>          the list: everyone, the favourites, a group; ?q= searches it
//     …/c/<contact>  …/c/<contact>/edit  …/new    with a contact open, being edited, or a new one
//   /upcoming                          birthdays and other dates
//   /bin                               the recycle bin
import { useEffect, useState } from "react";

export type Filter = { kind: "all" } | { kind: "favorites" } | { kind: "group"; id: string };

/** The contact shown beside the list. */
export type Open = { kind: "contact"; id: string; edit: boolean } | { kind: "new" } | null;

export type Route =
  { kind: "contacts"; filter: Filter; q: string; open: Open } | { kind: "upcoming" } | { kind: "bin" };

export const HOME: Route = { kind: "contacts", filter: { kind: "all" }, q: "", open: null };

const ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CONTACTS = new RegExp(`^(?:/favorites|/g/(${ID}))?(?:/c/(${ID})(/edit)?|/(new))?/?$`, "i");

export function parseRoute(url: { pathname: string; search: string } = location): Route {
  if (url.pathname === "/upcoming") return { kind: "upcoming" };
  if (url.pathname === "/bin") return { kind: "bin" };
  const m = CONTACTS.exec(url.pathname);
  if (!m) return HOME;
  const filter: Filter = m[1]
    ? { kind: "group", id: m[1].toLowerCase() }
    : url.pathname.startsWith("/favorites")
      ? { kind: "favorites" }
      : { kind: "all" };
  const open: Open = m[2] ? { kind: "contact", id: m[2].toLowerCase(), edit: !!m[3] } : m[4] ? { kind: "new" } : null;
  return { kind: "contacts", filter, q: new URLSearchParams(url.search).get("q") ?? "", open };
}

export function pathOf(route: Route): string {
  if (route.kind !== "contacts") return `/${route.kind}`;
  const { filter, open, q } = route;
  let path = filter.kind === "favorites" ? "/favorites" : filter.kind === "group" ? `/g/${filter.id}` : "";
  if (open?.kind === "contact") path += `/c/${open.id}${open.edit ? "/edit" : ""}`;
  else if (open?.kind === "new") path += "/new";
  return (path || "/") + (q ? `?${new URLSearchParams({ q })}` : "");
}

/** The same list with another contact open (or none). */
export const withOpen = (route: Route, open: Open): Route =>
  route.kind === "contacts" ? { ...route, open } : { ...HOME, open };

const NAVIGATE = "vinr:navigate";

/**
 * Asked before going to another view; answers true if that is all right. The editor sets one while
 * it holds unsaved changes.
 */
type LeaveGuard = (next: Route) => boolean;
let leaveGuard: LeaveGuard | null = null;

export function setLeaveGuard(guard: LeaveGuard | null): void {
  leaveGuard = guard;
}

/** Goes to a view, adding a history entry (or replacing the current one). False if the guard said no. */
export function go(route: Route, replace = false): boolean {
  const path = pathOf(route);
  if (path === location.pathname + location.search) return true;
  if (leaveGuard && !leaveGuard(route)) return false;
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  window.dispatchEvent(new Event(NAVIGATE));
  return true;
}

/** The view in the address bar, kept up to date. */
export function useRoute(): Route {
  const [route, setRoute] = useState(parseRoute);
  useEffect(() => {
    let current = location.pathname + location.search;
    const update = () => {
      current = location.pathname + location.search;
      setRoute(parseRoute());
    };
    const onPop = () => {
      // Back or Forward has already moved; with unsaved changes the user may want to stay.
      if (leaveGuard && !leaveGuard(parseRoute())) {
        history.pushState(null, "", current);
        return;
      }
      update();
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener(NAVIGATE, update);
    return () => {
      window.removeEventListener("popstate", onPop);
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
