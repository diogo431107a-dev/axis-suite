// What can be worked out from the stars: who is whose, in what order, and how to say it.
import { HUES, type Star } from "../../shared/protocol.ts";

export const PALETTE = ["#f1cf7e", "#9cc7ff", "#f4a7bb", "#9fe6c8", "#c9b0ff", "#ffb48a"] as const;
const GREEK = "αβγδεζηθικλμνξοπρστυφχψω";

export interface SkyIndex {
  byId: Map<string, Star>;
  children: Map<string, Star[]>;
  depth: Map<string, number>;
  /** The main star of each star's constellation. */
  root: Map<string, string>;
  /** Each star's letter within its constellation, nearest the main star first. */
  letter: Map<string, string>;
}

/** Stars come in creation order, so a star's letter never changes as others are added. */
export function buildIndex(stars: readonly Star[]): SkyIndex {
  const byId = new Map(stars.map((s) => [s.id, s]));
  const children = new Map<string, Star[]>(stars.map((s) => [s.id, []]));
  for (const s of stars) if (s.parent !== null) children.get(s.parent)?.push(s);
  const depth = new Map<string, number>();
  const root = new Map<string, string>();
  const letter = new Map<string, string>();
  for (const main of stars) {
    if (main.parent !== null) continue;
    depth.set(main.id, 0);
    root.set(main.id, main.id);
    const queue = [main];
    for (let n = 0; n < queue.length; n++) {
      const s = queue[n]!;
      letter.set(s.id, GREEK[n] ?? String(n + 1));
      for (const c of children.get(s.id)!) {
        depth.set(c.id, depth.get(s.id)! + 1);
        root.set(c.id, main.id);
        queue.push(c);
      }
    }
  }
  return { byId, children, depth, root, letter };
}

export const isMain = (s: Star): boolean => s.parent === null;
export const nameOf = (s: Star): string => s.name.trim() || "Unnamed";
export const relationOf = (s: Star): string => s.relation.trim() || "relative";
export const possessive = (name: string): string => (/s$/i.test(name) ? `${name}’` : `${name}’s`);

export function rootOf(index: SkyIndex, id: string): Star {
  return index.byId.get(index.root.get(id)!)!;
}

export function hueOf(index: SkyIndex, id: string): number {
  return rootOf(index, id).hue % PALETTE.length;
}

export function colourOf(index: SkyIndex, id: string): string {
  return PALETTE[hueOf(index, id)]!;
}

/** The ids of every star charted around this one. */
export function descendants(index: SkyIndex, id: string): string[] {
  const out: string[] = [];
  const stack = [...(index.children.get(id) ?? [])];
  while (stack.length > 0) {
    const c = stack.pop()!;
    out.push(c.id);
    stack.push(...(index.children.get(c.id) ?? []));
  }
  return out;
}

/** From the main star down to this one. */
export function chain(index: SkyIndex, id: string): Star[] {
  const out: Star[] = [];
  let s = index.byId.get(id);
  while (s) {
    out.unshift(s);
    s = s.parent !== null ? index.byId.get(s.parent) : undefined;
  }
  return out;
}

export interface PhrasePart {
  text: string;
  /** The star this part names; the last part is the star itself and has none. */
  id?: string;
  title?: string;
}

/** "Bob’s brother’s wife", in parts, or null for a main star. */
export function phraseParts(index: SkyIndex, id: string): PhrasePart[] | null {
  const c = chain(index, id);
  if (c.length < 2) return null;
  return c.map((s, i): PhrasePart => {
    if (i === 0) return { text: possessive(nameOf(s)), id: s.id };
    if (i < c.length - 1) return { text: possessive(relationOf(s)), id: s.id, title: nameOf(s) };
    return { text: relationOf(s) };
  });
}

export function phraseText(index: SkyIndex, id: string): string {
  const parts = phraseParts(index, id);
  return parts ? parts.map((p) => p.text).join(" ") : "Someone you know";
}

/** The colour fewest constellations have. */
export function nextHue(stars: readonly Star[]): number {
  const used = new Array<number>(HUES).fill(0);
  for (const s of stars) if (isMain(s)) used[s.hue % HUES]!++;
  let best = 0;
  used.forEach((n, i) => {
    if (n < used[best]!) best = i;
  });
  return best;
}

/** For searching: no accents, no capitals. */
export const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function searchStars(stars: readonly Star[], query: string, limit = 8): Star[] {
  const term = fold(query.trim());
  if (!term) return [];
  return stars.filter((s) => fold(nameOf(s)).includes(term) || fold(s.memo).includes(term)).slice(0, limit);
}
