import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_SETTINGS, type Message } from "../../shared/protocol.ts";
import { createChats } from "../chat/chats.ts";
import type { Tree } from "../chat/tree.ts";
import type { MemoryRunRequest, MemoryRunResult, MemoryRunner } from "../claude/memory.ts";
import { createCompanions } from "../companions.ts";
import { openDatabase } from "../db.ts";
import { createLikes } from "../likes.ts";
import { consolidate, hasPending } from "./consolidate.ts";
import { rebuild } from "./rebuild.ts";
import { windowFor } from "./history.ts";
import { peekSnapshot, snapshotFor } from "./inject.ts";
import { createScheduler } from "./scheduler.ts";
import { createMemory } from "./store.ts";

const LIMITS = { fileBytes: 8192, storyBytes: 16384, files: 20, viewChars: 16_000 };
type Command = Anthropic.Beta.BetaMemoryTool20250818Command;

/**
 * A memory model that makes the given commands with the tool it is handed, then finishes. It
 * remembers every request, so a test can read what it was given.
 */
function scriptedModel(steps: (request: MemoryRunRequest) => Command[], end: Partial<MemoryRunResult> = {}) {
  const asked: MemoryRunRequest[] = [];
  const run: MemoryRunner = async (request) => {
    asked.push(request);
    for (const command of steps(request)) {
      try {
        await request.tool.run(command as never);
      } catch (err) {
        // The model is told, and carries on.
        if (process.env.DEBUG_TOOL) console.log("tool refused:", command, err);
      }
    }
    return { stopReason: "end_turn", stopDetails: null, attempts: [], text: "Updated.", ...end };
  };
  return { run, asked };
}

function setup() {
  const db = openDatabase(":memory:");
  const companions = createCompanions(db, "odin", DEFAULT_SETTINGS);
  const companion = companions.save("comp-0001", { name: "Wealhtheow", profile: "<personality>Queen.</personality>" });
  const chats = createChats(db, "odin", companions, 5);
  chats.create({ id: "chat-0001", companionId: companion.id });
  const memory = createMemory(db, LIMITS);
  return { db, companion, chats, memory, tree: chats.tree("chat-0001") };
}

const put = (tree: Tree, parentId: number | null, role: "user" | "assistant", said: string): number => {
  const message = tree.add({ parentId, role, content: [{ type: "text", text: said }], isGreeting: parentId === null });
  tree.setLeaf(message.id);
  return message.id;
};

const addFact = (fact: string): Command[] => [
  { command: "insert", path: "/memories/user.md", insert_line: 3, insert_text: `- ${fact}` },
];

describe("consolidation", () => {
  it("files the new messages of the selected path, through the memory tool", async () => {
    const { db, companion, memory, tree } = setup();
    const greeting = put(tree, null, "assistant", "Welcome, cup-bearer.");
    put(tree, greeting, "user", "My name is Eadric, and I have a sister, Hild.");
    const model = scriptedModel(() => addFact("Has a sister, Hild."));
    const outcome = await consolidate(
      { db, memory, limits: LIMITS, run: model.run, maxIterations: 8 },
      "chat-0001",
      companion,
    );
    expect(outcome).toMatchObject({ kind: "done", summary: "Updated." });
    expect(memory.read(companion.id, "user.md")?.content).toContain("Has a sister, Hild.");
    expect(model.asked[0]!.prompt).toContain("[USER] My name is Eadric");
    expect(model.asked[0]!.prompt).toContain("<current_memory>");
    expect(model.asked[0]!.system).toContain("This chat is canon");
    expect(hasPending(db, "chat-0001")).toBe(false);
  });

  it("is idempotent: run again with nothing new, it does nothing and asks nobody", async () => {
    const { db, companion, memory, tree } = setup();
    put(tree, null, "assistant", "Welcome.");
    const model = scriptedModel(() => addFact("x"));
    const deps = { db, memory, limits: LIMITS, run: model.run, maxIterations: 8 };
    await consolidate(deps, "chat-0001", companion);
    const versions = memory.versions(companion.id, "user.md").length;
    expect(await consolidate(deps, "chat-0001", companion)).toMatchObject({ kind: "nothing" });
    expect(model.asked).toHaveLength(1);
    expect(memory.versions(companion.id, "user.md")).toHaveLength(versions);
  });

  it("never sends a reply that wasn't selected", async () => {
    const { db, companion, memory, tree } = setup();
    const greeting = put(tree, null, "assistant", "Welcome.");
    const mine = put(tree, greeting, "user", "Hello.");
    put(tree, mine, "assistant", "A rejected version.");
    put(tree, mine, "assistant", "The chosen version.");
    const model = scriptedModel(() => []);
    await consolidate({ db, memory, limits: LIMITS, run: model.run, maxIterations: 8 }, "chat-0001", companion);
    expect(model.asked[0]!.prompt).toContain("The chosen version.");
    expect(model.asked[0]!.prompt).not.toContain("A rejected version.");
  });

  it("changes nothing when the model is declined, and tries again next time", async () => {
    const { db, companion, memory, tree } = setup();
    put(tree, null, "assistant", "Welcome.");
    const before = memory.files(companion.id);
    const declined = scriptedModel(() => addFact("half done"), {
      stopReason: "refusal",
      stopDetails: { category: "general_harms", explanation: "Declined." },
    });
    const outcome = await consolidate(
      { db, memory, limits: LIMITS, run: declined.run, maxIterations: 8 },
      "chat-0001",
      companion,
    );
    expect(outcome).toMatchObject({ kind: "failed" });
    expect(memory.files(companion.id)).toEqual(before);
    expect(db.prepare("SELECT count(*) AS n FROM memory_files WHERE space LIKE 'scratch:%'").get()).toEqual({ n: 0 });
    expect(hasPending(db, "chat-0001")).toBe(true);
  });

  it("changes nothing when the model runs out of steps", async () => {
    const { db, companion, memory, tree } = setup();
    put(tree, null, "assistant", "Welcome.");
    const tired = scriptedModel(() => addFact("half"), { stopReason: "tool_use" });
    const outcome = await consolidate(
      { db, memory, limits: LIMITS, run: tired.run, maxIterations: 3 },
      "chat-0001",
      companion,
    );
    expect(outcome).toMatchObject({ kind: "failed", error: expect.stringContaining("3 of its steps") });
    expect(memory.read(companion.id, "user.md")?.content).not.toContain("half");
  });

  it("gives an edited message's old and new words, then files the new ones", async () => {
    const { db, companion, memory, tree } = setup();
    const greeting = put(tree, null, "assistant", "Welcome.");
    const mine = put(tree, greeting, "user", "My sister is Hild.");
    const model = scriptedModel(() => []);
    const deps = { db, memory, limits: LIMITS, run: model.run, maxIterations: 8 };
    await consolidate(deps, "chat-0001", companion);
    tree.edit(mine, "My sister is Hilda.");
    await consolidate(deps, "chat-0001", companion);
    expect(model.asked[1]!.prompt).toContain('was edited. It said: "My sister is Hild."');
    expect(model.asked[1]!.prompt).toContain('It now says: "My sister is Hilda."');
    expect(hasPending(db, "chat-0001")).toBe(false);
  });

  it("gives a deleted message, and one left on another branch with what replaced it", async () => {
    const { db, companion, memory, tree } = setup();
    const greeting = put(tree, null, "assistant", "Welcome.");
    const mine = put(tree, greeting, "user", "Hello.");
    put(tree, mine, "assistant", "I have a scar on my hand.");
    const other = put(tree, greeting, "user", "Who goes there?");
    const model = scriptedModel(() => []);
    const deps = { db, memory, limits: LIMITS, run: model.run, maxIterations: 8 };
    // File the second branch's message too, then go back to the first one and delete it.
    tree.select(other);
    await consolidate(deps, "chat-0001", companion);
    tree.select(mine);
    await consolidate(deps, "chat-0001", companion);
    expect(model.asked[1]!.prompt).toContain('left on an abandoned branch. It said: "Who goes there?"');
    expect(model.asked[1]!.prompt).toContain('The selected path has instead: "Hello."');
    tree.remove(mine);
    await consolidate(deps, "chat-0001", companion);
    expect(model.asked[2]!.prompt).toContain('was deleted. It said: "Hello."');
    expect(model.asked[2]!.prompt).toContain('It said: "I have a scar on my hand."');
  });

  it("passes on why replies were rejected, once", async () => {
    const { db, companion, chats, memory, tree } = setup();
    const greeting = put(tree, null, "assistant", "Welcome.");
    chats.feedback("chat-0001", null, "Too formal, she would tease me.");
    const model = scriptedModel(() => []);
    const deps = { db, memory, limits: LIMITS, run: model.run, maxIterations: 8 };
    await consolidate(deps, "chat-0001", companion);
    expect(model.asked[0]!.prompt).toContain('About the greeting: "Too formal, she would tease me."');
    put(tree, greeting, "user", "Hi.");
    await consolidate(deps, "chat-0001", companion);
    expect(model.asked[1]!.prompt).not.toContain("Too formal");
  });

  it("passes on praise for liked replies once, again when it changes, and when it is taken back", async () => {
    const { db, companion, chats, memory, tree } = setup();
    const likes = createLikes(db, chats);
    const greeting = put(tree, null, "assistant", "Welcome.");
    const mine = put(tree, greeting, "user", "Hello.");
    const passed = put(tree, mine, "assistant", "Good day to you.");
    const liked = put(tree, mine, "assistant", "*raises an eyebrow* You again?");
    const model = scriptedModel(() => []);
    const deps = { db, memory, limits: LIMITS, run: model.run, maxIterations: 8 };
    await consolidate(deps, "chat-0001", companion);
    expect(model.asked[0]!.prompt).not.toContain("<praise>");

    // A like without a comment is yours alone.
    likes.like("chat-0001", liked);
    expect(hasPending(db, "chat-0001")).toBe(false);

    likes.like("chat-0001", liked, "The dry teasing.");
    likes.like("chat-0001", passed, "Polite, for once.");
    expect(hasPending(db, "chat-0001")).toBe(true);
    await consolidate(deps, "chat-0001", companion);
    const praise = model.asked[1]!.prompt;
    expect(praise).toContain("<praise>\nThe user liked these replies");
    expect(praise).toContain('"*raises an eyebrow* You again?"\n  The user said: "The dry teasing."');
    expect(praise).toContain('Another version of it: "Good day to you."');
    expect(praise).toContain("not on the selected path: it is about the writing only");
    expect(hasPending(db, "chat-0001")).toBe(false);

    likes.like("chat-0001", liked, "The dry teasing and the eyebrow.");
    likes.unlike("chat-0001", passed);
    await consolidate(deps, "chat-0001", companion);
    const changed = model.asked[2]!.prompt;
    expect(changed).toContain('Before, the user had said: "The dry teasing."');
    expect(changed).toContain(
      '<withdrawn_praise>\nThe user took back this praise. Remove what came only from it.\n- "Polite, for once."',
    );
    expect(hasPending(db, "chat-0001")).toBe(false);
  });

  it("gives praise to a rebuild, and leaves nothing pending after it", async () => {
    const { db, companion, chats, memory, tree } = setup();
    const likes = createLikes(db, chats);
    const greeting = put(tree, null, "assistant", "Welcome, cup-bearer.");
    likes.like("chat-0001", greeting, "A queen's welcome.");
    const model = scriptedModel(() => []);
    const deps = { db, memory, limits: LIMITS, run: model.run, maxIterations: 8 };
    await consolidate(deps, "chat-0001", companion);
    await rebuild({ ...deps, partTokens: 20_000 }, companion);
    expect(model.asked[1]!.prompt).toContain('A greeting the user liked:\n  "Welcome, cup-bearer."');
    expect(hasPending(db, "chat-0001")).toBe(false);
  });

  it("keeps a one-shot chat out of the story", async () => {
    const { db, companion, chats, memory, tree } = setup();
    chats.change("chat-0001", { mode: "one-shot" });
    put(tree, null, "assistant", "In this dream, we are pirates.");
    const model = scriptedModel(() => [
      { command: "create", path: "/memories/story/recent.md", file_text: "# Recent\n- Pirates.\n" },
      ...addFact("Likes pirate stories."),
    ]);
    await consolidate({ db, memory, limits: LIMITS, run: model.run, maxIterations: 8 }, "chat-0001", companion);
    expect(memory.read(companion.id, "story/recent.md")?.content).not.toContain("Pirates");
    expect(memory.read(companion.id, "user.md")?.content).toContain("Likes pirate stories.");
    expect(model.asked[0]!.system).toContain("standalone one-shot");
  });

  it("re-files a chat whose mode changed after it was filed", async () => {
    const { db, companion, chats, memory, tree } = setup();
    put(tree, null, "assistant", "Welcome.");
    const model = scriptedModel(() => []);
    const deps = { db, memory, limits: LIMITS, run: model.run, maxIterations: 8 };
    await consolidate(deps, "chat-0001", companion);
    chats.change("chat-0001", { mode: "one-shot" });
    expect(hasPending(db, "chat-0001")).toBe(true);
    await consolidate(deps, "chat-0001", companion);
    expect(model.asked[1]!.prompt).toContain("was filed into memory as canon and is now one-shot");
  });

  it("takes a canon chat switched to one-shot back out of world.md and story/, once", async () => {
    const { db, companion, chats, memory, tree } = setup();
    const greeting = put(tree, null, "assistant", "We sail at dawn, captain.");
    const summary = "- The two of them sank the Grey Gull.";
    const ship = "- The Grey Gull, a sunken ship.";
    const model = scriptedModel((request) => {
      const run = model.asked.length;
      if (run === 1) {
        return [
          {
            command: "str_replace",
            path: "/memories/story/recent.md",
            old_str: "newest last.\n",
            new_str: `newest last.\n${summary}\n`,
          },
          { command: "insert", path: "/memories/world.md", insert_line: 3, insert_text: ship },
        ];
      }
      if (run === 2) {
        expect(request.system).toContain("take them back out");
        return [
          { command: "str_replace", path: "/memories/story/recent.md", old_str: `${summary}\n`, new_str: "" },
          { command: "str_replace", path: "/memories/world.md", old_str: `${ship}\n`, new_str: "" },
        ];
      }
      // An ordinary one-shot run afterwards is locked out of the story again.
      return [{ command: "insert", path: "/memories/world.md", insert_line: 3, insert_text: "- A pirate island." }];
    });
    const deps = { db, memory, limits: LIMITS, run: model.run, maxIterations: 8 };

    await consolidate(deps, "chat-0001", companion);
    expect(memory.read(companion.id, "story/recent.md")?.content).toContain(summary);
    expect(memory.read(companion.id, "world.md")?.content).toContain(ship);

    chats.change("chat-0001", { mode: "one-shot" });
    await consolidate(deps, "chat-0001", companion);
    expect(memory.read(companion.id, "story/recent.md")?.content).not.toContain(summary);
    expect(memory.read(companion.id, "world.md")?.content).not.toContain(ship);
    expect(model.asked[1]!.system).not.toContain("Do not touch world.md or story/");
    expect(hasPending(db, "chat-0001")).toBe(false);

    put(tree, greeting, "user", "Hoist the sails!");
    await consolidate(deps, "chat-0001", companion);
    expect(model.asked[2]!.system).toContain("Do not touch world.md or story/");
    expect(memory.read(companion.id, "world.md")?.content).not.toContain("pirate island");
  });

  it("re-files a one-shot switched to canon with the story open, as any canon chat", async () => {
    const { db, companion, chats, memory, tree } = setup();
    chats.change("chat-0001", { mode: "one-shot" });
    put(tree, null, "assistant", "In this dream, we are pirates.");
    const model = scriptedModel(() =>
      model.asked.length === 2
        ? [{ command: "insert", path: "/memories/world.md", insert_line: 3, insert_text: "- The pirate ship." }]
        : [],
    );
    const deps = { db, memory, limits: LIMITS, run: model.run, maxIterations: 8 };
    await consolidate(deps, "chat-0001", companion);
    chats.change("chat-0001", { mode: "canon" });
    await consolidate(deps, "chat-0001", companion);
    expect(model.asked[1]!.system).toContain("This chat is canon");
    expect(model.asked[1]!.system).not.toContain("take them back out");
    expect(memory.read(companion.id, "world.md")?.content).toContain("The pirate ship.");
  });
});

describe("pausing memory", () => {
  /** A chat filed up to a greeting and a hello, then paused, then tried two ways. */
  async function paused() {
    const all = setup();
    const { db, companion, chats, memory, tree } = all;
    const likes = createLikes(db, chats);
    const greeting = put(tree, null, "assistant", "Welcome, cup-bearer.");
    const hello = put(tree, greeting, "user", "Hello, my queen.");
    const model = scriptedModel(() => []);
    const deps = { db, memory, limits: LIMITS, run: model.run, maxIterations: 8 };
    await consolidate(deps, "chat-0001", companion);
    chats.pause("chat-0001");
    const bold = put(tree, hello, "assistant", "A failed try at a reply.");
    const tried = put(tree, bold, "user", "Something I'd rather forget.");
    likes.like("chat-0001", bold, "Liked while trying.");
    chats.feedback("chat-0001", hello, "A reason given while paused.");
    return { ...all, deps, model, greeting, hello, bold, tried };
  }

  it("holds back what is written while paused, and tells the page", async () => {
    const { db, chats, deps, companion, model, bold, tried } = await paused();
    expect(chats.get("chat-0001").memoryPaused).toBe(true);
    expect(chats.page("chat-0001").offRecord).toEqual({ paused: [bold, tried], leftOut: [] });
    expect(hasPending(db, "chat-0001")).toBe(false);
    expect(await consolidate(deps, "chat-0001", companion)).toMatchObject({ kind: "nothing" });
    expect(model.asked).toHaveLength(1);
  });

  it("files it as usual when you resume and keep it", async () => {
    const { db, chats, deps, companion, model } = await paused();
    chats.resume("chat-0001", true);
    expect(chats.get("chat-0001").memoryPaused).toBe(false);
    expect(chats.page("chat-0001").offRecord).toEqual({ paused: [], leftOut: [] });
    expect(hasPending(db, "chat-0001")).toBe(true);
    await consolidate(deps, "chat-0001", companion);
    const read = model.asked[1]!.prompt;
    expect(read).toContain("A failed try at a reply.");
    expect(read).toContain("Something I'd rather forget.");
    expect(read).toContain("Liked while trying.");
    expect(read).toContain("A reason given while paused.");
  });

  it("never reads it when you resume and leave it out, not even as context", async () => {
    const { db, chats, deps, companion, model, tree, tried } = await paused();
    chats.resume("chat-0001", false);
    expect(chats.page("chat-0001").offRecord.leftOut).toHaveLength(2);
    expect(hasPending(db, "chat-0001")).toBe(false);
    put(tree, tried, "assistant", "What comes after resuming.");
    await consolidate(deps, "chat-0001", companion);
    const read = model.asked[1]!.prompt;
    expect(read).toContain("What comes after resuming.");
    expect(read).toContain("Hello, my queen.");
    for (const hidden of ["A failed try", "rather forget", "Liked while trying", "while paused"]) {
      expect(read).not.toContain(hidden);
    }
    // A rebuild leaves it out too, and leaves nothing pending.
    await rebuild({ ...deps, partTokens: 20_000 }, companion);
    expect(model.asked[2]!.prompt).not.toContain("A failed try");
    expect(model.asked[2]!.prompt).toContain("What comes after resuming.");
    expect(hasPending(db, "chat-0001")).toBe(false);
  });

  it("keeps a swipe of a filed reply, made while paused, out of what replaced it", async () => {
    const { chats, deps, companion, model, tree, hello } = await paused();
    chats.resume("chat-0001", true);
    await consolidate(deps, "chat-0001", companion);
    // The filed reply is swiped away while paused: memory hears it was abandoned, not for what.
    chats.pause("chat-0001");
    put(tree, hello, "assistant", "A swipe while paused.");
    chats.resume("chat-0001", false);
    await consolidate(deps, "chat-0001", companion);
    const read = model.asked[2]!.prompt;
    expect(read).toContain("was left on an abandoned branch, with nothing in its place");
    expect(read).not.toContain("A swipe while paused.");
  });

  it("can't be paused for a companion without memory", () => {
    const { db, companion } = setup();
    const companions = createCompanions(db, "odin", DEFAULT_SETTINGS);
    companions.save("comp-0002", { name: "Grendel", memory: false });
    const chats = createChats(db, "odin", companions, 5);
    chats.create({ id: "chat-0002", companionId: "comp-0002" });
    expect(() => chats.pause("chat-0002")).toThrow(/no memory/);
    expect(companion.memory).toBe(true);
  });
});

describe("the window", () => {
  const messages = (count: number): Message[] =>
    Array.from({ length: count }, (_, n) => ({
      id: n + 1,
      parentId: n === 0 ? null : n,
      role: n % 2 === 0 ? "assistant" : "user",
      content: [{ type: "text", text: "x".repeat(400) }],
      instruction: null,
      isGreeting: n === 0,
      at: "",
      editedAt: null,
      reply: null,
    }));

  it("sends everything while it fits", () => {
    expect(windowFor(messages(10), null, 10_000, 2)).toEqual({ from: 0, startId: null, slid: false });
  });

  it("drops the oldest exchanges in chunks, starting at one of your messages, within the budget", () => {
    const path = messages(41); // about 108 tokens each
    const at = windowFor(path, null, 2_000, 5);
    expect(at.slid).toBe(true);
    expect(path[at.from]!.role).toBe("user");
    expect((at.from - 1) % 10).toBe(0);
    expect(path.slice(at.from).length * 108).toBeLessThanOrEqual(2_000);
  });

  it("stays where it is until the path outgrows it again", () => {
    const path = messages(41);
    const first = windowFor(path, null, 2_000, 5);
    const again = windowFor([...path, ...messages(2).map((m) => ({ ...m, id: m.id + 100 }))], first.startId, 2_000, 5);
    expect(again).toMatchObject({ from: first.from, slid: false });
  });

  it("starts over when you branched off above it", () => {
    const at = windowFor(messages(10), 999, 10_000, 2);
    expect(at).toEqual({ from: 0, startId: null, slid: true });
  });

  it("with slideTo, slides further down once it has to slide, and not before", () => {
    const path = messages(41); // about 4,400 tokens
    expect(windowFor(path, null, 5_000, 5, 1_000)).toEqual({ from: 0, startId: null, slid: false });
    const plain = windowFor(path, null, 2_000, 5);
    const further = windowFor(path, null, 2_000, 5, 1_000);
    expect(path[further.from]!.role).toBe("user");
    expect(further.from).toBeGreaterThan(plain.from);
    expect(path.slice(further.from).length * 108).toBeLessThanOrEqual(1_000);
  });
});

describe("the memory a chat sees", () => {
  it("is a snapshot: it doesn't change under a chat until it is taken again", () => {
    const { db, companion, memory } = setup();
    db.prepare("UPDATE chats SET last_activity_at = ? WHERE id = 'chat-0001'").run(new Date().toISOString());
    const first = snapshotFor(db, memory, "chat-0001", companion);
    expect(first).toContain('<memory_file path="character_canon.md">');
    expect(first).toContain("This chat is canon");
    memory.write(companion.id, "user.md", "# The user\n- New fact.\n", { op: "manual_edit", source: "manual" });
    expect(snapshotFor(db, memory, "chat-0001", companion)).toBe(first);
    expect(peekSnapshot(db, memory, "chat-0001", companion)).toBe(first);
  });

  it("is taken again once the chat has sat longer than the cache lasts", () => {
    const { db, companion, memory } = setup();
    const first = snapshotFor(db, memory, "chat-0001", companion);
    memory.write(companion.id, "user.md", "# The user\n- New fact.\n", { op: "manual_edit", source: "manual" });
    const later = Date.now() + 2 * 60 * 60_000;
    expect(snapshotFor(db, memory, "chat-0001", companion, later)).not.toBe(first);
  });
});

describe("the scheduler", () => {
  it("folds in a chat that has been quiet, and leaves one that just failed alone", async () => {
    const { db, companion, memory, tree } = setup();
    put(tree, null, "assistant", "Welcome.");
    db.prepare("UPDATE chats SET last_activity_at = '2026-01-01T00:00:00.000Z'").run();
    const failing = scriptedModel(() => [], { stopReason: "refusal" });
    const scheduler = createScheduler({
      db,
      memory,
      limits: LIMITS,
      run: failing.run,
      maxIterations: 8,
      idleMinutes: 30,
      cleanup: { every: 10, days: 7 },
      partTokens: 20_000,
    });
    expect(scheduler.sweep()).toEqual(["chat-0001"]);
    await scheduler.now("chat-0001");
    expect(scheduler.sweep()).toEqual([]);
    // Something new in the chat after the failed run: worth trying again once it goes quiet.
    put(tree, tree.activeLeaf(), "user", "Hello?");
    const inTwoHours = Date.now() + 2 * 60 * 60_000;
    expect(scheduler.sweep()).toEqual([]);
    expect(scheduler.sweep(inTwoHours)).toEqual(["chat-0001"]);
    void companion;
  });
});
