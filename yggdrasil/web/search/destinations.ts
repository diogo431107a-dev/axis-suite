// The places Move to… offers: bullets whose text has every word typed (ignoring case and
// accents), in the order of the tree, with the path to each. Never the bullets being moved or
// anything under them, deleted bullets, or bullets the user may only read.
import type { Node } from "../../shared/protocol.ts";
import type { Store } from "../model/store.ts";
import { plainText } from "../text/plain.ts";
import { normalize } from "./query.ts";

export interface Destination {
  /** null: the top level (Home). */
  id: string | null;
  name: string;
  /** The names of the bullets above it, from the top. */
  path: string[];
}

export const MAX_DESTINATIONS = 50;

const nameOf = (node: Node) => plainText(node.content) || "Untitled";

export function moveTargets(
  store: Store,
  ids: readonly string[],
  query: string,
  showCompleted: boolean,
  limit = MAX_DESTINATIONS,
): Destination[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const moving = new Set(ids);
  const out: Destination[] = [];
  const fits = (name: string) => {
    const text = normalize(name);
    return words.every((w) => text.includes(w));
  };
  if (fits("Home")) out.push({ id: null, name: "Home", path: [] });

  const shown = (id: string) => {
    const node = store.get(id);
    if (!node || node.deletedAt !== null || moving.has(id)) return undefined;
    return showCompleted || node.completedAt === null ? node : undefined;
  };
  // Without words: Home and the top of each tree, as in the sidebar.
  const tops = (list: readonly string[]) => list.map(shown).filter((n): n is Node => n !== undefined);
  if (words.length === 0) {
    const own = tops(store.children(null));
    const shared = tops(store.sharedRoots()).filter((n) => store.sharedWithMe(n.id)?.permission === "write");
    for (const n of [...own, ...shared]) if (out.length < limit) out.push({ id: n.id, name: nameOf(n), path: [] });
    return out;
  }

  // canWrite: whether the user may add bullets here (the bullets shared with them inherit it).
  const walk = (list: readonly string[], path: string[], canWrite: boolean): void => {
    for (const id of list) {
      if (out.length >= limit) return;
      const node = shown(id);
      if (!node) continue;
      const share = store.sharedWithMe(id);
      const writable = canWrite || share?.permission === "write";
      const name = nameOf(node);
      if (writable && fits(name)) out.push({ id, name, path });
      walk(store.children(id), [...path, name], writable);
    }
  };
  walk(store.children(null), [], true);
  walk(store.sharedRoots(), [], false);
  return out;
}
