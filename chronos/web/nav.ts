// Where the page is: every view has its own address, so Back and Forward work and a month or an
// event can be bookmarked. Caddy and Vite send every path to index.html.
//
//   /                  this month           /month/2026-10    a month
//   /agenda            what's coming, day by day
//   …?event=<id>       with an event open    …?edit=<id>       being edited
//   …?new=2026-10-13   a new event on a day (?new alone: today)
import { useEffect, useState } from "react";
import { isDate, isMonth } from "../shared/dates.ts";

export type View = { kind: "month"; month: string | null } | { kind: "agenda" };

/** The event shown over the view. */
export type Open =
  { kind: "event"; id: string } | { kind: "edit"; id: string } | { kind: "new"; date: string | null } | null;

export interface Route {
  view: View;
  open: Open;
}

export const HOME: Route = { view: { kind: "month", month: null }, open: null };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRoute(url: { pathname: string; search: string } = location): Route {
  const path = url.pathname.replace(/\/+$/, "");
  let view: View = { kind: "month", month: null };
  if (path === "/agenda") view = { kind: "agenda" };
  else if (path.startsWith("/month/") && isMonth(path.slice(7))) view = { kind: "month", month: path.slice(7) };
  const q = new URLSearchParams(url.search);
  const event = q.get("event");
  const edit = q.get("edit");
  const fresh = q.get("new");
  let open: Open = null;
  if (event && ID.test(event)) open = { kind: "event", id: event.toLowerCase() };
  else if (edit && ID.test(edit)) open = { kind: "edit", id: edit.toLowerCase() };
  else if (fresh !== null) open = { kind: "new", date: isDate(fresh) ? fresh : null };
  return { view, open };
}

export function pathOf(route: Route): string {
  const { view, open } = route;
  const path = view.kind === "agenda" ? "/agenda" : view.month ? `/month/${view.month}` : "/";
  if (!open) return path;
  const q: Record<string, string> =
    open.kind === "event" ? { event: open.id } : open.kind === "edit" ? { edit: open.id } : { new: open.date ?? "" };
  return `${path}?${new URLSearchParams(q)}`;
}

/** The same view with another event open (or none). */
export const withOpen = (route: Route, open: Open): Route => ({ ...route, open });

const NAVIGATE = "chronos:navigate";

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
