// Small helpers for the page.
import type { EntrySummary, Group } from "../shared/protocol.ts";

/** For matching: lower case, accents removed ("Éclair" → "eclair"). */
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * The address to open for an entry's URL field, or null if it isn't a web page. People often
 * type "github.com", so a bare host gets https://. Never javascript: and the like.
 */
export function openableUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/** The host name to show for a URL ("github.com"), or the text itself. */
export function hostOf(url: string): string {
  const href = openableUrl(url);
  return href ? new URL(href).host : url;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
export const formatDate = (iso: string) => dateFormat.format(new Date(iso));

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
export const compareText = (a: string, b: string) => collator.compare(a, b);

/** Groups by id, with their paths of names ("Work › Servers"). */
export function groupPaths(groups: Group[]): Map<string, string[]> {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const paths = new Map<string, string[]>();
  const pathOf = (id: string, seen: Set<string>): string[] => {
    const known = paths.get(id);
    if (known) return known;
    const g = byId.get(id);
    if (!g || seen.has(id)) return [];
    seen.add(id);
    const path = [...(g.parentId ? pathOf(g.parentId, seen) : []), g.name];
    paths.set(id, path);
    return path;
  };
  for (const g of groups) pathOf(g.id, new Set());
  return paths;
}

/** Whether an entry matches every word of a search, in its title, username, URL or group path. */
export function matches(entry: EntrySummary, words: string[], groupPath: string[] | undefined): boolean {
  const haystack = normalize([entry.title, entry.username, entry.url, ...(groupPath ?? [])].join("\n"));
  return words.every((w) => haystack.includes(w));
}

/** The words of a search box, normalized. */
export const searchWords = (query: string) => normalize(query).split(/\s+/).filter(Boolean);
