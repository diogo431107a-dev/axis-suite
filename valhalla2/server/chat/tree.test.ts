import { describe, expect, it } from "vitest";
import { blockText, DEFAULT_SETTINGS } from "../../shared/protocol.ts";
import { createCompanions } from "../companions.ts";
import { openDatabase } from "../db.ts";
import { StoreError } from "../errors.ts";
import { createChats } from "./chats.ts";
import type { Tree } from "./tree.ts";

function setup() {
  const db = openDatabase(":memory:");
  const companions = createCompanions(db, "odin", DEFAULT_SETTINGS);
  companions.save("comp-0001", { name: "Hrothgar", profile: "<personality>Proud.</personality>" });
  const chats = createChats(db, "odin", companions, 5);
  chats.create({ id: "chat-0001", companionId: "comp-0001" });
  return { db, chats, tree: chats.tree("chat-0001") };
}

const text = (said: string) => [{ type: "text", text: said }];

/** Adds a message and selects it, the way a finished turn does. */
function put(tree: Tree, parentId: number | null, role: "user" | "assistant", said: string): number {
  const message = tree.add({
    parentId,
    role,
    content: text(said),
    isGreeting: parentId === null && role === "assistant",
  });
  tree.setLeaf(message.id);
  return message.id;
}

const words = (tree: Tree) => tree.activePath().map((message) => message.content.map(blockText).join(""));

describe("the selected path", () => {
  it("runs from the greeting down to the end of the path", () => {
    const { tree } = setup();
    const greeting = put(tree, null, "assistant", "Hail.");
    const mine = put(tree, greeting, "user", "My lord.");
    put(tree, mine, "assistant", "Sit.");
    expect(words(tree)).toEqual(["Hail.", "My lord.", "Sit."]);
  });

  it("follows the swipe that is selected, and keeps the others", () => {
    const { tree } = setup();
    const greeting = put(tree, null, "assistant", "Hail.");
    const mine = put(tree, greeting, "user", "My lord.");
    const first = put(tree, mine, "assistant", "Sit.");
    const second = put(tree, mine, "assistant", "Stand.");
    expect(words(tree)).toEqual(["Hail.", "My lord.", "Stand."]);
    expect(tree.siblingsOf(tree.get(second))).toEqual([first, second]);
    tree.select(first);
    expect(words(tree)).toEqual(["Hail.", "My lord.", "Sit."]);
  });

  it("goes down to the newest line below a message you select", () => {
    const { tree } = setup();
    const greeting = put(tree, null, "assistant", "Hail.");
    const mine = put(tree, greeting, "user", "My lord.");
    const sit = put(tree, mine, "assistant", "Sit.");
    put(tree, sit, "user", "I will.");
    put(tree, mine, "assistant", "Stand.");
    tree.select(sit);
    expect(words(tree)).toEqual(["Hail.", "My lord.", "Sit.", "I will."]);
  });

  it("branches: the path ends at a message, and what you say next starts a new line there", () => {
    const { tree } = setup();
    const greeting = put(tree, null, "assistant", "Hail.");
    put(tree, greeting, "user", "My lord.");
    tree.branchFrom(greeting);
    expect(words(tree)).toEqual(["Hail."]);
    put(tree, greeting, "user", "Who are you?");
    expect(words(tree)).toEqual(["Hail.", "Who are you?"]);
    expect(tree.siblingsOf(tree.activePath()[1]!)).toHaveLength(2);
  });
});

describe("editing and deleting", () => {
  it("edits in place and keeps the old words", () => {
    const { db, tree } = setup();
    const greeting = put(tree, null, "assistant", "Hail.");
    tree.edit(greeting, "Hail, friend.");
    expect(words(tree)).toEqual(["Hail, friend."]);
    const old = db.prepare("SELECT content FROM message_revisions WHERE message_id = ?").get(greeting) as {
      content: string;
    };
    expect(JSON.parse(old.content)).toEqual(text("Hail."));
  });

  it("deletes a message with everything below it, and the path moves to what survives", () => {
    const { tree } = setup();
    const greeting = put(tree, null, "assistant", "Hail.");
    const mine = put(tree, greeting, "user", "My lord.");
    const sit = put(tree, mine, "assistant", "Sit.");
    const stand = put(tree, mine, "assistant", "Stand.");
    put(tree, stand, "user", "No.");
    tree.remove(stand);
    expect(words(tree)).toEqual(["Hail.", "My lord.", "Sit."]);
    tree.remove(sit);
    expect(words(tree)).toEqual(["Hail.", "My lord."]);
    expect(() => tree.get(stand)).toThrow(StoreError);
  });

  it("leaves the path alone when the deleted message isn't on it", () => {
    const { tree } = setup();
    const greeting = put(tree, null, "assistant", "Hail.");
    const mine = put(tree, greeting, "user", "My lord.");
    const sit = put(tree, mine, "assistant", "Sit.");
    put(tree, mine, "assistant", "Stand.");
    tree.remove(sit);
    expect(words(tree)).toEqual(["Hail.", "My lord.", "Stand."]);
  });

  it("an emptied chat has no path", () => {
    const { tree } = setup();
    const greeting = put(tree, null, "assistant", "Hail.");
    tree.remove(greeting);
    expect(tree.activePath()).toEqual([]);
    expect(tree.activeLeaf()).toBeNull();
  });
});

describe("what memory has to correct", () => {
  const consolidated = (db: ReturnType<typeof setup>["db"]) =>
    db.prepare("UPDATE messages SET consolidated_at = '2026-11-13T00:00:00.000Z'").run();
  const flagged = (db: ReturnType<typeof setup>["db"]) =>
    (db.prepare("SELECT id FROM messages WHERE needs_correction = 1 ORDER BY id").all() as { id: number }[]).map(
      (row) => row.id,
    );

  it("marks a remembered message that is edited", () => {
    const { db, tree } = setup();
    const greeting = put(tree, null, "assistant", "Hail.");
    consolidated(db);
    tree.edit(greeting, "Hail, friend.");
    expect(flagged(db)).toEqual([greeting]);
  });

  it("marks remembered messages that are deleted, all the way down", () => {
    const { db, tree } = setup();
    const greeting = put(tree, null, "assistant", "Hail.");
    const mine = put(tree, greeting, "user", "My lord.");
    const sit = put(tree, mine, "assistant", "Sit.");
    consolidated(db);
    tree.remove(mine);
    expect(flagged(db)).toEqual([mine, sit]);
  });

  it("marks remembered messages left behind by a swipe or a branch", () => {
    const { db, tree } = setup();
    const greeting = put(tree, null, "assistant", "Hail.");
    const mine = put(tree, greeting, "user", "My lord.");
    const sit = put(tree, mine, "assistant", "Sit.");
    consolidated(db);
    put(tree, mine, "assistant", "Stand.");
    expect(flagged(db)).toEqual([sit]);
    tree.branchFrom(greeting);
    expect(flagged(db)).toEqual([mine, sit]);
  });

  it("marks nothing that was never remembered", () => {
    const { db, tree } = setup();
    const greeting = put(tree, null, "assistant", "Hail.");
    tree.edit(greeting, "Hail, friend.");
    tree.remove(greeting);
    expect(flagged(db)).toEqual([]);
  });

  it("marks a whole remembered chat when its mode changes", () => {
    const { db, tree, chats } = setup();
    const greeting = put(tree, null, "assistant", "Hail.");
    consolidated(db);
    chats.change("chat-0001", { mode: "one-shot" });
    expect(flagged(db)).toEqual([greeting]);
  });
});

describe("asking why replies keep being rejected", () => {
  it("asks once the fifth swipe on a reply is there, and only once", () => {
    const { chats, tree } = setup();
    const greeting = put(tree, null, "assistant", "Hail.");
    const mine = put(tree, greeting, "user", "My lord.");
    const replies = () => chats.page("chat-0001").path.at(-1)!;
    put(tree, mine, "assistant", "Sit.");
    for (let swipe = 1; swipe < 5; swipe++) {
      put(tree, mine, "assistant", `Version ${swipe + 1}`);
      expect(replies().ask).toBe(false);
    }
    put(tree, mine, "assistant", "Version 6");
    expect(replies().siblings).toHaveLength(6);
    expect(replies().ask).toBe(true);
    chats.feedback("chat-0001", mine, null);
    put(tree, mine, "assistant", "Version 7");
    expect(replies().ask).toBe(false);
  });

  it("asks about greetings too", () => {
    const { chats, tree } = setup();
    for (let n = 0; n < 6; n++) put(tree, null, "assistant", `Hail ${n}.`);
    expect(chats.page("chat-0001").path[0]!.ask).toBe(true);
    chats.feedback("chat-0001", null, "Too formal.");
    expect(chats.page("chat-0001").path[0]!.ask).toBe(false);
    expect(tree.feedbackFor(null)?.reason).toBe("Too formal.");
  });
});

describe("whose chat it is", () => {
  it("is nobody else's", () => {
    const { db } = setup();
    const others = createChats(db, "freya", createCompanions(db, "freya", DEFAULT_SETTINGS), 5);
    expect(() => others.page("chat-0001")).toThrow(StoreError);
    expect(() => others.tree("chat-0001")).toThrow(StoreError);
    expect(others.list()).toEqual([]);
  });
});
