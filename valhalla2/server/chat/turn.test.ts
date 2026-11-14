import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_SETTINGS, blockText, type ContentBlock, type StreamEvent } from "../../shared/protocol.ts";
import { DEFAULT_PROMPTS, OPENER } from "../../shared/prompts.ts";
import type { Reply, Writer } from "../claude.ts";
import { createCompanions } from "../companions.ts";
import { openDatabase } from "../db.ts";
import { createMemory } from "../memory/store.ts";

const LIMITS = { fileBytes: 8192, storyBytes: 16384, files: 20, viewChars: 16_000 };
import { createChats } from "./chats.ts";
import { generate, send, type TurnContext } from "./turn.ts";

/** A writer that answers with the next of `lines`, and remembers every request it was given. */
function scripted(...lines: string[]) {
  const asked: Anthropic.Beta.BetaMessageParam[][] = [];
  const write: Writer = (_system, messages, settings, onEvent) => {
    asked.push(messages);
    const line = lines.shift();
    if (line === undefined) return Promise.reject(new Error("The API is down"));
    onEvent({ type: "delta", text: line });
    return Promise.resolve({
      content: [{ type: "text", text: line }],
      details: {
        model: settings.model,
        stopReason: "end_turn",
        stopDetails: null,
        usage: null,
        servedBy: null,
        declinedBy: null,
        attempts: null,
      },
    } satisfies Reply);
  };
  return { write, asked };
}

function setup(write: Writer) {
  const db = openDatabase(":memory:");
  const companions = createCompanions(db, "odin", DEFAULT_SETTINGS);
  companions.save("comp-0001", { name: "Hrothgar", profile: "<personality>Proud.</personality>" });
  const chats = createChats(db, "odin", companions, 5);
  chats.create({ id: "chat-0001", companionId: "comp-0001" });
  const tree = chats.tree("chat-0001");
  const events: StreamEvent[] = [];
  const context: TurnContext = {
    db,
    tree,
    chatId: "chat-0001",
    companion: companions.get("comp-0001"),
    memory: createMemory(db, LIMITS),
    window: { tokens: 100_000, chunk: 10 },
    write,
    onEvent: (event) => events.push(event),
  };
  return { db, chats, tree, context, events };
}

/** What a request said, message by message: "role: text". */
const transcript = (messages: Anthropic.Beta.BetaMessageParam[]) =>
  messages.map((message) => {
    const content = message.content as string | ContentBlock[];
    const said = typeof content === "string" ? content : content.map(blockText).join("");
    return `${message.role}: ${said}`;
  });

describe("the greeting", () => {
  it("is written after a hidden opener and the greeting instruction, and stored as the greeting", async () => {
    const { write, asked } = scripted("Hail, Eadric.");
    const { tree, context, events } = setup(write);
    const greeting = await generate(context, null);
    expect(transcript(asked[0]!)).toEqual([`user: ${OPENER}`, `system: ${DEFAULT_PROMPTS.greeting}`]);
    expect(greeting.isGreeting).toBe(true);
    expect(greeting.parentId).toBeNull();
    expect(greeting.instruction).toBe(DEFAULT_PROMPTS.greeting);
    expect(tree.activeLeaf()).toBe(greeting.id);
    expect(events).toContainEqual({ type: "delta", text: "Hail, Eadric." });
  });

  it("is sent again exactly the same way on every later turn", async () => {
    const { write, asked } = scripted("Hail.", "Sit.");
    const { context } = setup(write);
    await generate(context, null);
    await send(context, "My lord.");
    expect(transcript(asked[1]!)).toEqual([
      `user: ${OPENER}`,
      `system: ${DEFAULT_PROMPTS.greeting}`,
      "assistant: Hail.",
      "user: My lord.",
    ]);
  });

  it("uses the companion's own instruction when it has one", async () => {
    const { write, asked } = scripted("Hail.");
    const { context } = setup(write);
    await generate({ ...context, companion: { ...context.companion, prompts: { greeting: "Open gruffly." } } }, null);
    expect(transcript(asked[0]!)[1]).toBe("system: Open gruffly.");
  });
});

describe("a turn", () => {
  it("stores your message and the reply together, and moves the path to the reply", async () => {
    const { write } = scripted("Hail.", "Sit.");
    const { tree, context } = setup(write);
    await generate(context, null);
    const reply = await send(context, "My lord.");
    expect(tree.activePath().map((message) => message.role)).toEqual(["assistant", "user", "assistant"]);
    expect(tree.activeLeaf()).toBe(reply.id);
  });

  it("stores nothing when the reply fails, so it can simply be sent again", async () => {
    const { write } = scripted("Hail.");
    const { tree, context } = setup(write);
    await generate(context, null);
    await expect(send(context, "My lord.")).rejects.toThrow("The API is down");
    expect(tree.activePath()).toHaveLength(1);
  });
});

describe("another version of a reply", () => {
  it("is written against the path up to its parent, never against the other versions", async () => {
    const { write, asked } = scripted("Hail.", "Sit.", "Stand.", "Kneel.");
    const { tree, context } = setup(write);
    await generate(context, null);
    const sit = await send(context, "My lord.");
    await generate(context, sit.parentId);
    expect(transcript(asked[2]!)).toEqual(transcript(asked[1]!));
    await send(context, "Why?");
    expect(transcript(asked[3]!)).not.toContain("assistant: Sit.");
    expect(transcript(asked[3]!)).toContain("assistant: Stand.");
    expect(tree.siblingsOf(sit)).toHaveLength(2);
  });

  it("carries the reason you gave for rejecting the others, and keeps carrying it", async () => {
    const { write, asked } = scripted("Hail.", "Sit.", "Stand.", "Fine.");
    const { chats, context } = setup(write);
    await generate(context, null);
    const sit = await send(context, "My lord.");
    chats.feedback("chat-0001", sit.parentId, "He would never be polite.");
    const stand = await generate(context, sit.parentId);
    const note = DEFAULT_PROMPTS.rejection.replace("{reason}", "He would never be polite.");
    expect(transcript(asked[2]!).at(-1)).toBe(`system: ${note}`);
    expect(stand.instruction).toBe(note);
    await send(context, "So be it.");
    expect(transcript(asked[3]!)).toContain(`system: ${note}`);
  });

  it("only answers your messages", async () => {
    const { write } = scripted("Hail.", "Sit.");
    const { context } = setup(write);
    const greeting = await generate(context, null);
    await expect(generate(context, greeting.id)).rejects.toThrow("can only answer one of your messages");
  });
});

describe("deleted messages", () => {
  it("are never sent", async () => {
    const { write, asked } = scripted("Hail.", "Sit.", "Stand.");
    const { tree, context } = setup(write);
    await generate(context, null);
    const sit = await send(context, "My lord.");
    tree.remove(sit.parentId!);
    await send(context, "Who goes there?");
    expect(transcript(asked[2]!)).not.toContain("user: My lord.");
    expect(transcript(asked[2]!)).not.toContain("assistant: Sit.");
  });
});

describe("a long chat", () => {
  it("lets its oldest exchanges slide out in a chunk, and asks for them to be filed in memory", async () => {
    const lines = Array.from({ length: 30 }, (_, n) => `Reply ${n} ${"y".repeat(400)}`);
    const { write, asked } = scripted(...lines);
    const { context } = setup(write);
    let slides = 0;
    const small = { ...context, window: { tokens: 1_500, chunk: 3 }, onSlide: () => slides++ };
    await generate(small, null);
    for (let n = 0; n < 12; n++) await send(small, `Message ${n} ${"x".repeat(400)}`);
    expect(slides).toBeGreaterThan(0);
    const last = transcript(asked.at(-1)!);
    expect(last[0]).toMatch(/^user: Message \d+/);
    expect(last.join("\n")).not.toContain("Message 0 ");
    expect(last.at(-1)).toMatch(/^user: Message 11 /);
  });
});
