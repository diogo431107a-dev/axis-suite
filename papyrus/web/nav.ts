// Where the page is: every view has its own address, so Back and Forward work and a day can be
// bookmarked. Caddy and Vite send every path to index.html.
import { useEffect, useState } from "react";
import { isDate } from "../shared/dates.ts";

export type Route =
  | { kind: "home" }
  | { kind: "day"; journalId: string; date: string }
  /** month: any day of it */
  | { kind: "month"; month: string; journalId: string | null }
  | { kind: "year"; year: number; journalId: string | null }
  | { kind: "search"; q: string; journalId: string | null }
  | { kind: "bin" };

const ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const DAY = new RegExp(`^/j/(${ID})/(\\d{4}-\\d{2}-\\d{2})/?$`, "i");
const MONTH = /^\/calendar\/(\d{4}-\d{2})\/?$/;
const YEAR = /^\/year\/(\d{4})\/?$/;

export function parseRoute(url: { pathname: string; search: string } = location): Route {
  const params = new URLSearchParams(url.search);
  const journalId = params.get("journal");
  const journal = journalId && new RegExp(`^${ID}$`, "i").test(journalId) ? journalId.toLowerCase() : null;
  let m = DAY.exec(url.pathname);
  if (m && isDate(m[2])) return { kind: "day", journalId: m[1]!.toLowerCase(), date: m[2] };
  m = MONTH.exec(url.pathname);
  if (m && isDate(`${m[1]}-01`)) return { kind: "month", month: `${m[1]}-01`, journalId: journal };
  m = YEAR.exec(url.pathname);
  if (m && Number(m[1]) >= 1000) return { kind: "year", year: Number(m[1]), journalId: journal };
  if (url.pathname === "/search") return { kind: "search", q: params.get("q") ?? "", journalId: journal };
  if (url.pathname === "/bin") return { kind: "bin" };
  return { kind: "home" };
}

export function pathOf(route: Route): string {
  const withJournal = (path: string, journalId: string | null, extra: Record<string, string> = {}) => {
    const params = new URLSearchParams(extra);
    if (journalId) params.set("journal", journalId);
    const s = params.toString();
    return s ? `${path}?${s}` : path;
  };
  switch (route.kind) {
    case "home":
      return "/";
    case "day":
      return `/j/${route.journalId}/${route.date}`;
    case "month":
      return withJournal(`/calendar/${route.month.slice(0, 7)}`, route.journalId);
    case "year":
      return withJournal(`/year/${route.year}`, route.journalId);
    case "search":
      return withJournal("/search", route.journalId, route.q ? { q: route.q } : {});
    case "bin":
      return "/bin";
  }
}

const NAVIGATE = "papyrus:navigate";

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
