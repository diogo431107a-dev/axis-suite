import { describe, expect, it } from "vitest";
import type { Node } from "../../shared/protocol.ts";
import { Store, newNode } from "../model/store.ts";
import { moveTargets } from "./destinations.ts";

const DONE = "2026-10-01T00:00:00Z";
const n = (id: string, parentId: string | null, rank: string, content: string, extra: Partial<Node> = {}) => ({
  ...newNode(id, parentId, rank),
  content,
  ...extra,
});

// work
//   Projects
//     Café plans
//     old plans (completed)
//     gone plans (deleted)
// home plans
// odin's "shared" (read only), with "inside plans" and "open" (shared to edit), "open plans" in it
function tree(): Store {
  const s = new Store();
  s.load(
    [
      n("work", null, "a0", "work"),
      n("projects", "work", "a0", "**Projects**"),
      n("cafe", "projects", "a0", "Café plans"),
      n("old", "projects", "a1", "old plans", { completedAt: DONE }),
      n("gone", "projects", "a2", "gone plans", { deletedAt: DONE }),
      n("home", null, "a1", "home plans"),
      n("shared", null, "a2", "shared plans"),
      n("inside", "shared", "a0", "inside plans"),
      n("open", "shared", "a1", "open"),
      n("openPlans", "open", "a0", "open plans"),
    ],
    {
      byMe: [],
      withMe: [
        { id: "shared", owner: "odin", permission: "read" },
        { id: "open", owner: "odin", permission: "write" },
      ],
    },
  );
  return s;
}

const ids = (list: { id: string | null }[]) => list.map((d) => d.id);

describe("moveTargets", () => {
  it("offers Home and the tops of the trees before anything is typed", () => {
    expect(ids(moveTargets(tree(), [], "", true))).toEqual([null, "work", "home"]);
  });

  it("finds every word, ignoring case, accents and markup, with the path", () => {
    const found = moveTargets(tree(), [], "cafe PLANS", true);
    expect(found).toEqual([{ id: "cafe", name: "Café plans", path: ["work", "Projects"] }]);
  });

  it("leaves out completed bullets when they are hidden, deleted and read-only ones", () => {
    expect(ids(moveTargets(tree(), [], "plans", true))).toEqual(["cafe", "old", "home", "openPlans"]);
    expect(ids(moveTargets(tree(), [], "plans", false))).toEqual(["cafe", "home", "openPlans"]);
  });

  it("never offers the bullets being moved or anything under them", () => {
    expect(ids(moveTargets(tree(), ["projects"], "plans", true))).toEqual(["home", "openPlans"]);
    expect(ids(moveTargets(tree(), ["work"], "", true))).toEqual([null, "home"]);
  });

  it("offers Home when its name is typed", () => {
    expect(ids(moveTargets(tree(), [], "hom", true))).toEqual([null, "home"]);
  });
});
