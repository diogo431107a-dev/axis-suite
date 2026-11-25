import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../shared/protocol.ts";
import { DEFAULT_PROMPTS } from "../../shared/prompts.ts";
import { createChats } from "../chat/chats.ts";
import type { SceneAsk, SceneReader } from "../claude/scene.ts";
import { createCompanions } from "../companions.ts";
import { openDatabase } from "../db.ts";
import { linesOf } from "./lines.ts";
import { createScenes, momentRequest, sheetOf } from "./sheet.ts";

const ANSWER = {
  place: "The mead hall",
  time: "Night",
  weather: "Rain outside; both soaked",
  light: "Firelight",
  people: [
    { name: "Freya", appearance: "Gold hair, wet", clothes: "Soaked dress", action: "By the fire", mood: "Teasing" },
  ],
  lines: [
    { line: 1, feeling: "narration", strength: 1 },
    { line: 2, feeling: "teasing", strength: 3 },
  ],
};

function setup(answer: unknown = ANSWER) {
  const db = openDatabase(":memory:");
  const companions = createCompanions(db, "odin", DEFAULT_SETTINGS);
  const companion = companions.save("comp-0001", { name: "Freya", profile: "Gold hair." });
  const chats = createChats(db, "odin", companions, 5);
  chats.create({ id: "chat-0001", companionId: "comp-0001" });
  const tree = chats.tree("chat-0001");
  const asked = tree.add({ parentId: null, role: "user", content: [{ type: "text", text: "Wet enough?" }] });
  const reply = tree.add({
    parentId: asked.id,
    role: "assistant",
    content: [{ type: "text", text: "*Wrings out her hair.* You look like a drowned cat." }],
  });
  tree.setLeaf(reply.id);
  const asks: SceneAsk[] = [];
  const read: SceneReader = async (ask) => {
    asks.push(ask);
    return { raw: answer, model: "claude-haiku-5-5", cost: 0.002 };
  };
  const scenes = createScenes({ db, read, model: "claude-haiku-5-5" });
  const request = (files: { path: string; content: string; updatedAt: string }[] = []) =>
    momentRequest(companion, { files, pins: [] }, tree.pathTo(reply.id), 1000);
  return { db, tree, asked, reply, asks, scenes, request };
}

describe("working out a moment", () => {
  it("asks once with the chat up to the moment and its numbered lines, and keeps the reading", async () => {
    const { reply, asks, scenes, request } = setup();
    const scene = await scenes.of(reply.id, request());
    expect(asks).toHaveLength(1);
    expect(asks[0]!.system).toBe(DEFAULT_PROMPTS.scene);
    expect(asks[0]!.moment).toContain("1. (action) Wrings out her hair.\n2. (speech) You look like a drowned cat.");
    expect(asks[0]!.moment).toContain('<message speaker="The user">\nWet enough?');
    expect(scene.sheet.weather).toBe("Rain outside; both soaked");
    expect(scene.sheet.lines.map((line) => [line.text, line.feeling, line.strength])).toEqual([
      ["Wrings out her hair.", "narration", 1],
      ["You look like a drowned cat.", "teasing", 3],
    ]);
    expect(scene.cost).toBe(0.002);

    await scenes.of(reply.id, request());
    expect(asks).toHaveLength(1);
    expect(scenes.peek(reply.id, request())?.sheet).toEqual(scene.sheet);
  });

  it("asked twice at once, asks once", async () => {
    const { reply, asks, scenes, request } = setup();
    await Promise.all([scenes.of(reply.id, request()), scenes.of(reply.id, request())]);
    expect(asks).toHaveLength(1);
  });

  it("isn't read again when only the memory changed, but is when the chat before it did", async () => {
    const { tree, asked, reply, asks, scenes, request } = setup();
    await scenes.of(reply.id, request());
    await scenes.of(reply.id, request([{ path: "story/recent.md", content: "It rained.", updatedAt: "" }]));
    expect(asks).toHaveLength(1);
    tree.edit(asked.id, "Soaked enough?");
    expect(scenes.peek(reply.id, request())).toBeNull();
    await scenes.of(reply.id, request());
    expect(asks).toHaveLength(2);
  });

  it("reads afresh when asked to", async () => {
    const { reply, asks, scenes, request } = setup();
    await scenes.of(reply.id, request());
    await scenes.of(reply.id, request(), true);
    expect(asks).toHaveLength(2);
  });

  it("keeps your correction, also when the chat before it changes, until the reply's own words do", async () => {
    const { tree, asked, reply, asks, scenes, request } = setup();
    const read = await scenes.of(reply.id, request());
    const corrected = scenes.save(reply.id, request(), {
      ...read.sheet,
      weather: "Dry: it was the lake",
      lines: read.sheet.lines.map((line) => ({ ...line, feeling: "cold", strength: 2 })),
    });
    expect(corrected.edited).toBe(true);
    expect(corrected.sheet.weather).toBe("Dry: it was the lake");
    expect(corrected.sheet.lines.map((line) => line.feeling)).toEqual(["cold", "cold"]);
    // The words stay the reply's own, whatever was sent.
    expect(corrected.sheet.lines[1]!.text).toBe("You look like a drowned cat.");

    tree.edit(asked.id, "Soaked enough?");
    expect((await scenes.of(reply.id, request())).sheet.weather).toBe("Dry: it was the lake");
    expect(asks).toHaveLength(1);

    tree.edit(reply.id, "You look fine.");
    expect(scenes.peek(reply.id, request())).toBeNull();
  });

  it("refuses a correction whose lines no longer match, or with an unknown feeling", async () => {
    const { reply, scenes, request } = setup();
    const read = await scenes.of(reply.id, request());
    expect(() => scenes.save(reply.id, request(), { ...read.sheet, lines: [] })).toThrow(/don't match/);
    expect(() =>
      scenes.save(reply.id, request(), {
        ...read.sheet,
        lines: read.sheet.lines.map((line) => ({ ...line, feeling: "smug" })),
      }),
    ).toThrow(/feeling/);
  });

  it("has no lines for one of your messages", async () => {
    const { tree, asked, asks, scenes, db } = setup();
    const companion = createCompanions(db, "odin", DEFAULT_SETTINGS).get("comp-0001");
    const request = momentRequest(companion, { files: [], pins: [] }, tree.pathTo(asked.id), 1000);
    const scene = await scenes.of(asked.id, request);
    expect(scene.sheet.lines).toEqual([]);
    expect(asks[0]!.moment).not.toContain("<lines>");
  });
});

describe("Claude's answer", () => {
  it("is read plainly where something is missing or unknown", () => {
    const lines = linesOf("*Nods.* Yes. No.");
    const sheet = sheetOf({ place: 7, lines: [{ line: 2, feeling: "smug", strength: 9 }] }, lines);
    expect(sheet.place).toBe("");
    expect(sheet.people).toEqual([]);
    expect(sheet.lines.map((line) => [line.feeling, line.strength])).toEqual([
      ["narration", 2],
      ["neutral", 2],
      ["neutral", 2],
    ]);
  });
});
