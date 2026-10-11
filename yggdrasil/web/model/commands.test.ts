import { generateNKeysBetween } from "fractional-indexing";
import { describe, expect, it } from "vitest";
import type { Node } from "../../shared/protocol.ts";
import * as cmd from "./commands.ts";
import { Store, newNode } from "./store.ts";

/**
 * Builds a store from indented lines, two spaces per level. A bullet's id is its text; "[+]"
 * marks it collapsed and "[x]" completed.
 */
function build(text: string): Store {
  const store = new Store();
  const nodes: Node[] = [];
  const stack: { indent: number; id: string }[] = [];
  const counters = new Map<string | null, string[]>();
  const lines = text
    .trim()
    .split("\n")
    .filter((l) => l.trim());
  for (const line of lines) {
    const indent = line.length - line.trimStart().length;
    while (stack.length > 0 && stack.at(-1)!.indent >= indent) stack.pop();
    const parentId = stack.at(-1)?.id ?? null;
    const body = line.trim();
    const id = body.replace(/ \[[+x]\]/g, "");
    nodes.push({
      ...newNode(id, parentId, ""),
      content: id,
      collapsed: body.includes("[+]"),
      completedAt: body.includes("[x]") ? "2026-01-01T00:00:00.000Z" : null,
    });
    stack.push({ indent, id });
  }
  for (const n of nodes) {
    const list = counters.get(n.parentId) ?? [];
    list.push(n.id);
    counters.set(n.parentId, list);
  }
  for (const [, ids] of counters) {
    const ranks = generateNKeysBetween(null, null, ids.length);
    ids.forEach((id, i) => (nodes.find((n) => n.id === id)!.rank = ranks[i]!));
  }
  store.load(nodes);
  return store;
}

/** The tree in the same notation, deleted bullets left out and "·" for an empty one. */
function dump(store: Store, parentId: string | null = null, depth = 0): string {
  return store
    .children(parentId)
    .map((id) => store.get(id)!)
    .filter((n) => n.deletedAt === null)
    .map((n) => {
      const marks = (n.collapsed ? " [+]" : "") + (n.completedAt ? " [x]" : "");
      const line = `${"  ".repeat(depth)}${n.content || "·"}${marks}`;
      const kids = dump(store, n.id, depth + 1);
      return kids ? `${line}\n${kids}` : line;
    })
    .join("\n");
}

const outline = (text: string) => text.trim().replace(/^ {6}/gm, "");

function ctxOf(store: Store, root: string | null = null): cmd.Ctx {
  let n = 0;
  return {
    get: (id) => store.get(id),
    children: (p) => store.children(p),
    shown: (p) => store.children(p).filter((id) => store.get(id)!.deletedAt === null),
    expanded: (id) => id === root || !store.get(id)!.collapsed,
    root,
    newId: () => `new${++n}`,
    now: () => "2026-10-11T12:00:00.000Z",
  };
}

/** Applies a result, checks the tree, then that undo and redo get back to before and after. */
function check(store: Store, result: cmd.Result | null, expected: string) {
  expect(result).not.toBeNull();
  const before = dump(store);
  const inverse = store.applyAll(result!.ops);
  expect(dump(store)).toBe(outline(expected));
  const redo = store.applyAll(inverse);
  expect(dump(store)).toBe(before);
  store.applyAll(redo);
  expect(dump(store)).toBe(outline(expected));
}

const TREE = `
A
  B
    C
  D
E
`;

describe("enter", () => {
  it("splits at the caret into a new bullet below", () => {
    const store = build("Hello world\nNext");
    const result = cmd.enter(ctxOf(store), "Hello world", 5, 5);
    expect(result.caret).toEqual({ id: "new1", offset: 0 });
    check(
      store,
      result,
      `
      Hello
       world
      Next
    `,
    );
  });

  it("puts the new bullet first under a bullet whose children are shown", () => {
    const store = build(TREE);
    check(
      store,
      cmd.enter(ctxOf(store), "A", 1, 1),
      `
      A
        ·
        B
          C
        D
      E
    `,
    );
  });

  it("puts it after the bullet when its children are collapsed", () => {
    const store = build("A [+]\n  B\nE");
    const ops = cmd.enter(ctxOf(store), "A", 1, 1).ops;
    store.applyAll(ops);
    expect(dump(store)).toBe(
      outline(`
      A [+]
        B
      ·
      E
    `),
    );
  });

  it("inserts an empty bullet above when the caret is at the start", () => {
    const store = build("A\nB");
    const result = cmd.enter(ctxOf(store), "B", 0, 0);
    expect(result.caret).toEqual({ id: "B", offset: 0 });
    store.applyAll(result.ops);
    expect(store.children(null).map((id) => store.get(id)!.content)).toEqual(["A", "", "B"]);
  });

  it("makes a first child when pressed in the zoomed-in bullet's title", () => {
    const store = build(TREE);
    check(
      store,
      cmd.enter(ctxOf(store, "A"), "A", 1, 1),
      `
      A
        ·
        B
          C
        D
      E
    `,
    );
  });
});

describe("indent and outdent", () => {
  it("indents under the previous sibling, at its end, expanding it", () => {
    const store = build("A [+]\n  B\nC\nD");
    check(
      store,
      cmd.indent(ctxOf(store), ["C", "D"]),
      `
      A
        B
        C
        D
    `,
    );
  });

  it("can't indent a first child", () => {
    expect(cmd.indent(ctxOf(build(TREE)), ["B"])).toBeNull();
  });

  it("outdents to right after the parent", () => {
    const store = build(TREE);
    check(
      store,
      cmd.outdent(ctxOf(store), ["B"]),
      `
      A
        D
      B
        C
      E
    `,
    );
  });

  it("doesn't outdent out of the top level or the zoomed-in bullet", () => {
    expect(cmd.outdent(ctxOf(build(TREE)), ["A"])).toBeNull();
    expect(cmd.outdent(ctxOf(build(TREE), "A"), ["B"])).toBeNull();
  });
});

describe("backspace and delete", () => {
  it("merges a bullet into the one above, children and all", () => {
    const store = build(TREE);
    const result = cmd.backspaceAtStart(ctxOf(store), "D")!;
    expect(result.caret).toEqual({ id: "C", offset: 1 });
    check(
      store,
      result,
      `
      A
        B
          CD
      E
    `,
    );
  });

  it("merges a first child into its parent, keeping its children in its place", () => {
    const store = build(TREE);
    check(
      store,
      cmd.backspaceAtStart(ctxOf(store), "B"),
      `
      AB
        C
        D
      E
    `,
    );
  });

  it("deletes an empty bullet and goes to the end of the one above", () => {
    const store = build("A\nB");
    store.applyAll([{ op: "update", id: "B", content: "" }]);
    const result = cmd.backspaceAtStart(ctxOf(store), "B")!;
    expect(result.caret).toEqual({ id: "A", offset: 1 });
    check(store, result, "A");
  });

  it("won't merge into the zoomed-in bullet", () => {
    expect(cmd.backspaceAtStart(ctxOf(build(TREE), "A"), "B")).toBeNull();
  });

  it("Delete at the end merges the bullet below", () => {
    const store = build(TREE);
    check(
      store,
      cmd.deleteAtEnd(ctxOf(store), "C"),
      `
      A
        B
          CD
      E
    `,
    );
  });
});

describe("moving", () => {
  it("swaps with the sibling above and below", () => {
    const store = build(TREE);
    check(
      store,
      cmd.moveUp(ctxOf(store), ["D"]),
      `
      A
        D
        B
          C
      E
    `,
    );
    const again = build(TREE);
    check(
      again,
      cmd.moveDown(ctxOf(again), ["A"]),
      `
      E
      A
        B
          C
        D
    `,
    );
  });

  it("leaves the parent at either end", () => {
    const store = build("A\n  B\nC\n  D\n  F");
    // D is C's first child: up goes to the end of A's children.
    check(
      store,
      cmd.moveUp(ctxOf(store), ["D"]),
      `
      A
        B
        D
      C
        F
    `,
    );
    const down = build("A\n  B\nC\n  D");
    // B is A's last child: down goes to the start of C's children.
    check(
      down,
      cmd.moveDown(ctxOf(down), ["B"]),
      `
      A
      C
        B
        D
    `,
    );
    const top = build("A\n  B\n  C");
    // No sibling above the parent: before the parent.
    check(
      top,
      cmd.moveUp(ctxOf(top), ["B"]),
      `
      B
      A
        C
    `,
    );
  });

  it("moves blocks of siblings together", () => {
    const store = build("A\nB\nC\nD");
    check(
      store,
      cmd.moveDown(ctxOf(store), ["A", "B"]),
      `
      C
      A
      B
      D
    `,
    );
  });

  it("drops bullets anywhere but inside themselves", () => {
    const store = build(TREE);
    check(
      store,
      cmd.moveTo(ctxOf(store), ["E"], "B", "C"),
      `
      A
        B
          C
          E
        D
    `,
    );
    expect(cmd.moveTo(ctxOf(store), ["A"], "C", null)).toBeNull();
  });
});

describe("other commands", () => {
  it("removes bullets and puts the caret above", () => {
    const store = build(TREE);
    const result = cmd.remove(ctxOf(store), ["D", "E"])!;
    expect(result.caret).toEqual({ id: "C", offset: 1 });
    check(
      store,
      result,
      `
      A
        B
          C
    `,
    );
  });

  it("completes, or uncompletes when all are completed", () => {
    const store = build("A [x]\nB");
    check(store, cmd.toggleComplete(ctxOf(store), ["A", "B"]), "A [x]\nB [x]");
    check(store, cmd.toggleComplete(ctxOf(store), ["A", "B"]), "A\nB");
  });

  it("collapses only bullets with children", () => {
    const store = build(TREE);
    check(store, cmd.setCollapsed(ctxOf(store), "A", true), TREE.replace("A\n", "A [+]\n"));
    expect(cmd.setCollapsed(ctxOf(store), "E", true)).toBeNull();
  });

  it("pastes a tree after the bullet, or into it when it is empty", () => {
    const drafts: cmd.Draft[] = [
      { content: "P", note: "n", children: [{ content: "Q", children: [] }] },
      { content: "R", completed: true, children: [] },
    ];
    const store = build("A\nE");
    const result = cmd.pasteDrafts(ctxOf(store), "A", drafts)!;
    expect(result.caret).toEqual({ id: "new3", offset: 1 });
    check(
      store,
      result,
      `
      A
      P
        Q
      R [x]
      E
    `,
    );

    const empty = build("A\nE");
    empty.applyAll([{ op: "update", id: "A", content: "" }]);
    check(
      empty,
      cmd.pasteDrafts(ctxOf(empty), "A", drafts),
      `
      P
        Q
      R [x]
      E
    `,
    );
  });
});

describe("above and below", () => {
  it("walk the outline as shown, skipping collapsed children", () => {
    const store = build("A\n  B [+]\n    C\n  D\nE");
    const ctx = ctxOf(store);
    const order = ["A", "B", "D", "E"];
    for (let i = 0; i < order.length; i++) {
      expect(cmd.below(ctx, order[i]!)).toBe(order[i + 1] ?? null);
      expect(cmd.above(ctx, order[i]!)).toBe(order[i - 1] ?? null);
    }
  });

  it("stay inside the zoomed-in bullet, whose title counts as a line", () => {
    const store = build(TREE);
    const ctx = ctxOf(store, "A");
    expect(cmd.above(ctx, "B")).toBe("A");
    expect(cmd.above(ctx, "A")).toBeNull();
    expect(cmd.below(ctx, "A")).toBe("B");
    expect(cmd.below(ctx, "D")).toBeNull();
  });
});
