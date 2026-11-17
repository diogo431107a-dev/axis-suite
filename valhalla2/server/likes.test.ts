import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../shared/protocol.ts";
import { createChats } from "./chat/chats.ts";
import { createCompanions } from "./companions.ts";
import { openDatabase } from "./db.ts";
import { createLikes, markFiled, praiseFor } from "./likes.ts";
import { hasPending } from "./memory/consolidate.ts";

function setup() {
  const db = openDatabase(":memory:");
  const companions = createCompanions(db, "odin", DEFAULT_SETTINGS);
  const companion = companions.save("comp-0001", { name: "Lina", profile: "<personality>A doll.</personality>" });
  const chats = createChats(db, "odin", companions, 5);
  chats.create({ id: "chat-0001", companionId: companion.id, title: "The storm" });
  const tree = chats.tree("chat-0001");
  const greeting = tree.add({
    parentId: null,
    role: "assistant",
    content: [{ type: "text", text: "I was carved from the old cherry tree." }],
    isGreeting: true,
  });
  const mine = tree.add({ parentId: greeting.id, role: "user", content: [{ type: "text", text: "Hello, Lina." }] });
  const first = tree.add({ parentId: mine.id, role: "assistant", content: [{ type: "text", text: "Hello." }] });
  const second = tree.add({
    parentId: mine.id,
    role: "assistant",
    content: [{ type: "text", text: "*curtsies, then winks* Hello, master." }],
  });
  tree.setLeaf(second.id);
  const likes = createLikes(db, chats);
  /** As if memory had everything else in the chat: only likes can make it pending. */
  const fileAll = () => db.prepare("UPDATE messages SET consolidated_at = '2026-01-01T00:00:00.000Z'").run();
  fileAll();
  const pending = () => praiseFor(db, "chat-0001", new Set(tree.activePath().map((m) => m.id)));
  return { db, chats, tree, likes, greeting, mine, first, second, pending };
}

describe("likes", () => {
  it("like, change the comment, and unlike, all shown on the page", () => {
    const { chats, likes, second } = setup();
    likes.like("chat-0001", second.id);
    expect(chats.page("chat-0001").liked).toEqual([{ messageId: second.id, comment: null }]);
    likes.like("chat-0001", second.id, "The wink.");
    expect(chats.page("chat-0001").liked).toEqual([{ messageId: second.id, comment: "The wink." }]);
    // Leaving the comment out keeps it.
    likes.like("chat-0001", second.id);
    expect(chats.page("chat-0001").liked[0]!.comment).toBe("The wink.");
    likes.like("chat-0001", second.id, "  ");
    expect(chats.page("chat-0001").liked[0]!.comment).toBeNull();
    likes.unlike("chat-0001", second.id);
    expect(chats.page("chat-0001").liked).toEqual([]);
  });

  it("only go on the companion's replies, not yours, a declined one or another person's", () => {
    const { db, tree, likes, mine, greeting } = setup();
    expect(() => likes.like("chat-0001", mine.id)).toThrow(/Only the companion's replies/);
    const declined = tree.add({
      parentId: mine.id,
      role: "assistant",
      content: [],
      reply: { model: "m", stopReason: "refusal", stopDetails: null, usage: null } as never,
    });
    expect(() => likes.like("chat-0001", declined.id)).toThrow(/declined/);
    const theirs = createLikes(db, createChats(db, "loki", createCompanions(db, "loki", DEFAULT_SETTINGS), 5));
    expect(() => theirs.like("chat-0001", greeting.id)).toThrow(/No such/);
  });

  it("without a comment are only for you: memory has nothing to read", () => {
    const { db, likes, second, pending } = setup();
    likes.like("chat-0001", second.id);
    expect(pending()).toEqual([]);
    expect(hasPending(db, "chat-0001")).toBe(false);
  });

  it("with a comment are praise, with the words as they were liked and the versions passed over", () => {
    const { db, tree, likes, second, pending } = setup();
    likes.like("chat-0001", second.id, "The wink.");
    tree.edit(second.id, "Something else entirely.");
    db.prepare("UPDATE messages SET needs_correction = 0").run();
    expect(hasPending(db, "chat-0001")).toBe(true);
    expect(pending()).toMatchObject([
      {
        kind: "new",
        text: "*curtsies, then winks* Hello, master.",
        comment: "The wink.",
        onPath: true,
        isGreeting: false,
        passedOver: ["Hello."],
      },
    ]);
  });

  it("on a version off the selected path say so", () => {
    const { tree, likes, first, pending } = setup();
    likes.like("chat-0001", first.id, "Short and sweet.");
    expect(pending()[0]).toMatchObject({ onPath: false, passedOver: ["*curtsies, then winks* Hello, master."] });
    tree.select(first.id);
    expect(pending()[0]!.onPath).toBe(true);
  });

  it("once filed are pending again only when changed, and are taken back when withdrawn", () => {
    const { db, likes, second, pending } = setup();
    likes.like("chat-0001", second.id, "The wink.");
    markFiled(db, pending(), "2026-02-01T00:00:00.000Z");
    expect(pending()).toEqual([]);

    likes.like("chat-0001", second.id, "The wink, and the curtsy.");
    expect(pending()).toMatchObject([{ kind: "changed", comment: "The wink, and the curtsy.", before: "The wink." }]);
    markFiled(db, pending(), "2026-02-02T00:00:00.000Z");

    // Kept as a like for you: memory takes the praise back, the like stays.
    likes.like("chat-0001", second.id, null);
    expect(pending()).toMatchObject([{ kind: "withdrawn", before: "The wink, and the curtsy.", comment: null }]);
    markFiled(db, pending(), "2026-02-03T00:00:00.000Z");
    expect(pending()).toEqual([]);
    expect(db.prepare("SELECT count(*) AS n FROM likes").get()).toEqual({ n: 1 });
  });

  it("unliked before memory heard of them simply go; after, they wait until it has", () => {
    const { db, likes, first, second, pending } = setup();
    likes.like("chat-0001", first.id, "Short.");
    likes.unlike("chat-0001", first.id);
    expect(db.prepare("SELECT count(*) AS n FROM likes").get()).toEqual({ n: 0 });

    likes.like("chat-0001", second.id, "The wink.");
    markFiled(db, pending(), "2026-02-01T00:00:00.000Z");
    likes.unlike("chat-0001", second.id);
    expect(pending()).toMatchObject([{ kind: "withdrawn", before: "The wink." }]);
    expect(db.prepare("SELECT count(*) AS n FROM likes").get()).toEqual({ n: 1 });
    markFiled(db, pending(), "2026-02-02T00:00:00.000Z");
    expect(db.prepare("SELECT count(*) AS n FROM likes").get()).toEqual({ n: 0 });
  });

  it("whose reply is deleted after they were filed are taken back", () => {
    const { db, tree, likes, first, pending } = setup();
    likes.like("chat-0001", first.id, "Short.");
    markFiled(db, pending(), "2026-02-01T00:00:00.000Z");
    tree.remove(first.id);
    expect(pending()).toMatchObject([{ kind: "withdrawn", before: "Short." }]);
    markFiled(db, pending(), "2026-02-02T00:00:00.000Z");
    expect(db.prepare("SELECT count(*) AS n FROM likes").get()).toEqual({ n: 0 });
  });

  it("go with their chat", () => {
    const { db, chats, likes, second } = setup();
    likes.like("chat-0001", second.id, "The wink.");
    chats.remove("chat-0001");
    expect(db.prepare("SELECT count(*) AS n FROM likes").get()).toEqual({ n: 0 });
  });
});
