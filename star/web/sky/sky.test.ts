import { describe, expect, it } from "vitest";
import type { Link, Star } from "../../shared/protocol.ts";
import { freeSpotNear, placeNear, step, type Motions } from "./layout.ts";
import {
  buildIndex,
  chain,
  descendants,
  fold,
  nextHue,
  phraseParts,
  phraseText,
  possessive,
  searchStars,
} from "./model.ts";

function star(id: string, parent: string | null = null, relation = "", fields: Partial<Star> = {}): Star {
  return { id, name: id, memo: "", parent, relation, hue: 0, x: 0, y: 0, ...fields };
}

const family = [
  star("Bob", null, "", { hue: 2 }),
  star("Mark", "Bob", "brother"),
  star("Helena", "Bob", "mother"),
  star("Julia", "Mark", "wife"),
  star("James", null, "", { hue: 1 }),
  star("Leo", "James", "son"),
];

describe("the sky's structure", () => {
  const index = buildIndex(family);

  it("follows a star back to its main star", () => {
    expect(chain(index, "Julia").map((s) => s.id)).toEqual(["Bob", "Mark", "Julia"]);
    expect(index.root.get("Julia")).toBe("Bob");
    expect(index.depth.get("Julia")).toBe(2);
    expect(index.depth.get("Bob")).toBe(0);
  });

  it("finds every star charted around one", () => {
    expect(descendants(index, "Bob").sort()).toEqual(["Helena", "Julia", "Mark"]);
    expect(descendants(index, "Julia")).toEqual([]);
  });

  it("gives letters per constellation, nearest the main star first, in creation order", () => {
    expect(["Bob", "Mark", "Helena", "Julia"].map((id) => index.letter.get(id))).toEqual(["α", "β", "γ", "δ"]);
    expect(["James", "Leo"].map((id) => index.letter.get(id))).toEqual(["α", "β"]);
  });

  it("runs out of letters gracefully", () => {
    const big = [star("m"), ...Array.from({ length: 30 }, (_, i) => star(`c${i}`, "m", "cousin"))];
    expect(buildIndex(big).letter.get("c29")).toBe("31");
  });
});

describe("how a star is described", () => {
  const index = buildIndex(family);

  it("says who is whose", () => {
    expect(phraseText(index, "Julia")).toBe("Bob’s brother’s wife");
    expect(phraseText(index, "Bob")).toBe("Someone you know");
  });

  it("keeps a name that ends in s right", () => {
    expect(phraseText(index, "Leo")).toBe("James’ son");
    expect(possessive("Ana")).toBe("Ana’s");
  });

  it("makes every step but the last a way to go there", () => {
    expect(phraseParts(index, "Julia")).toEqual([
      { text: "Bob’s", id: "Bob" },
      { text: "brother’s", id: "Mark", title: "Mark" },
      { text: "wife" },
    ]);
    expect(phraseParts(index, "Bob")).toBeNull();
  });

  it("has words for a missing name or relation", () => {
    const stars = [star("a", null, "", { name: "  " }), star("b", "a", " ")];
    expect(phraseText(buildIndex(stars), "b")).toBe("Unnamed’s relative");
  });
});

describe("search", () => {
  const people = [star("a", null, "", { name: "João" }), star("b", null, "", { name: "Tina", memo: "Mora em Évora" })];

  it("ignores accents and capitals, in names and memos", () => {
    expect(fold("João")).toBe("joao");
    expect(searchStars(people, "JOAO").map((s) => s.id)).toEqual(["a"]);
    expect(searchStars(people, "evora").map((s) => s.id)).toEqual(["b"]);
    expect(searchStars(people, "  ")).toEqual([]);
  });
});

describe("colours", () => {
  it("picks the colour fewest constellations have, counting only main stars", () => {
    expect(nextHue([])).toBe(0);
    const stars = [star("a", null, "", { hue: 0 }), star("b", "a", "son", { hue: 0 }), star("c", null, "", { hue: 1 })];
    expect(nextHue(stars)).toBe(2);
  });
});

describe("the layout", () => {
  function settled() {
    const stars = [
      star("main", null, "", { x: 100, y: -50 }),
      star("r1", "main", "son", { x: 100, y: -50 }),
      star("r2", "main", "wife", { x: 101, y: -50 }),
      star("r3", "r1", "wife", { x: 100, y: -49 }),
      star("other", null, "", { x: 400, y: 100 }),
      star("o1", "other", "son", { x: 410, y: 110 }),
    ];
    const links: Link[] = [{ id: "l", a: "r3", b: "o1", relation: "cousin" }];
    const index = buildIndex(stars);
    const motions: Motions = new Map();
    let alpha = 1;
    for (let i = 0; i < 400; i++) {
      step(stars, links, index, motions, alpha);
      alpha *= 0.985;
    }
    return stars;
  }

  it("never moves a main star", () => {
    const stars = settled();
    expect(stars[0]).toMatchObject({ x: 100, y: -50 });
    expect(stars[4]).toMatchObject({ x: 400, y: 100 });
  });

  it("spreads relatives out, with every position a real number", () => {
    const stars = settled();
    for (const s of stars) expect(Number.isFinite(s.x) && Number.isFinite(s.y)).toBe(true);
    const [, r1, r2] = stars;
    expect(Math.hypot(r1!.x - r2!.x, r1!.y - r2!.y)).toBeGreaterThan(40);
    expect(Math.hypot(r1!.x - 100, r1!.y + 50)).toBeGreaterThan(60);
  });

  it("copes with two stars on the very same spot", () => {
    const stars = [star("m"), star("a", "m", "son"), star("b", "m", "son")];
    const index = buildIndex(stars);
    const motions: Motions = new Map();
    for (let i = 0; i < 50; i++) step(stars, [], index, motions, 1);
    for (const s of stars) expect(Number.isFinite(s.x) && Number.isFinite(s.y)).toBe(true);
  });

  it("leaves a dragged star where the hand has it", () => {
    const stars = [star("m"), star("a", "m", "son", { x: 500, y: 500 })];
    const motions: Motions = new Map([["a", { vx: 0, vy: 0, fx: 0, fy: 0, dragging: true }]]);
    step(stars, [], buildIndex(stars), motions, 1);
    expect(stars[1]).toMatchObject({ x: 500, y: 500 });
  });

  it("places new stars near their star, and new constellations with room around them", () => {
    const near = placeNear({ x: 10, y: 10 });
    expect(Math.hypot(near.x - 10, near.y - 10)).toBeCloseTo(46);
    const spot = freeSpotNear([star("m")], 0, 0);
    expect(Math.hypot(spot.x, spot.y)).toBeGreaterThan(230);
    expect(freeSpotNear([], 5, 6)).toEqual({ x: 5, y: 6 });
  });
});
