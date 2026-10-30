// The sky the page shows, and every change to it. A change happens here at once and is handed to
// Sync to be saved; listeners redraw.
import type { Link, Op, Sky, Star } from "../../shared/protocol.ts";
import { buildIndex, descendants, isMain, nextHue, type SkyIndex } from "./model.ts";
import { placeNear } from "./layout.ts";

/** "structure" means stars or ties came or went; "text" that only words changed on one star. */
export type SkyChange = { kind: "structure" } | { kind: "text"; id: string };

type Listener = (change: SkyChange) => void;

const rounded = (n: number) => Math.round(n * 10) / 10;

export class SkyStore {
  stars: Star[] = [];
  links: Link[] = [];
  index: SkyIndex = buildIndex([]);
  rev = 0;
  /** Raised by every change, for React to notice. */
  version = 0;

  private readonly save: (op: Op) => void;
  private readonly listeners = new Set<Listener>();
  /** Where the server has each star. Stars move on the page all the time; this says which to save. */
  private saved = new Map<string, { x: number; y: number }>();

  constructor(save: (op: Op) => void) {
    this.save = save;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(change: SkyChange): void {
    if (change.kind === "structure") this.index = buildIndex(this.stars);
    this.version++;
    for (const listener of this.listeners) listener(change);
  }

  /** Takes the sky as the server has it. */
  load(sky: Sky): void {
    this.stars = sky.stars;
    this.links = sky.links;
    this.rev = sky.rev;
    this.saved = new Map(sky.stars.map((s) => [s.id, { x: s.x, y: s.y }]));
    this.changed({ kind: "structure" });
  }

  private add(fields: Pick<Star, "name" | "parent" | "relation" | "hue" | "x" | "y">): Star {
    const star: Star = { id: crypto.randomUUID(), memo: "", ...fields };
    star.x = rounded(star.x);
    star.y = rounded(star.y);
    this.stars.push(star);
    this.saved.set(star.id, { x: star.x, y: star.y });
    this.save({ op: "addStar", star: { ...star } });
    this.changed({ kind: "structure" });
    return star;
  }

  addMain(x: number, y: number): Star {
    return this.add({ name: "New star", parent: null, relation: "", hue: nextHue(this.stars), x, y });
  }

  addRelative(parentId: string, name: string, relation: string): Star {
    const parent = this.index.byId.get(parentId)!;
    return this.add({ name, parent: parentId, relation, hue: 0, ...placeNear(parent) });
  }

  update(id: string, patch: Partial<Pick<Star, "name" | "memo" | "relation">>): void {
    const star = this.index.byId.get(id);
    if (!star) return;
    Object.assign(star, patch);
    this.save({ op: "updateStar", id, ...patch });
    this.changed({ kind: "text", id });
  }

  remove(id: string): void {
    const gone = new Set([id, ...descendants(this.index, id)]);
    this.stars = this.stars.filter((s) => !gone.has(s.id));
    this.links = this.links.filter((l) => !gone.has(l.a) && !gone.has(l.b));
    for (const g of gone) this.saved.delete(g);
    this.save({ op: "removeStar", id });
    this.changed({ kind: "structure" });
  }

  /** The relative becomes a main star, connected to the star it was tied to. */
  promote(id: string): void {
    const star = this.index.byId.get(id);
    if (!star || isMain(star)) return;
    // Worked out before the star becomes a main star, so it isn't counted as one.
    const hue = nextHue(this.stars);
    const link: Link = { id: crypto.randomUUID(), a: star.parent!, b: id, relation: star.relation.trim() };
    star.parent = null;
    star.relation = "";
    star.hue = hue;
    this.links.push(link);
    this.save({ op: "promoteStar", id, hue, linkId: link.id });
    this.changed({ kind: "structure" });
  }

  addLink(a: string, b: string, relation: string): void {
    const link: Link = { id: crypto.randomUUID(), a, b, relation };
    this.links.push(link);
    this.save({ op: "addLink", link });
    this.changed({ kind: "structure" });
  }

  removeLink(id: string): void {
    this.links = this.links.filter((l) => l.id !== id);
    this.save({ op: "removeLink", id });
    this.changed({ kind: "structure" });
  }

  /** Saves the stars that have moved. Called when the layout comes to rest. */
  savePositions(): void {
    const moves: { id: string; x: number; y: number }[] = [];
    for (const s of this.stars) {
      const was = this.saved.get(s.id);
      if (was && Math.abs(was.x - s.x) < 0.5 && Math.abs(was.y - s.y) < 0.5) continue;
      const move = { id: s.id, x: rounded(s.x), y: rounded(s.y) };
      moves.push(move);
      this.saved.set(s.id, { x: move.x, y: move.y });
    }
    if (moves.length > 0) this.save({ op: "moveStars", moves });
  }
}
