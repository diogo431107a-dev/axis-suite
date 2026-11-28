import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../shared/protocol.ts";
import { DEFAULT_PROMPTS } from "../../shared/prompts.ts";
import { createChats } from "../chat/chats.ts";
import { createCompanions } from "../companions.ts";
import { openDatabase } from "../db.ts";
import type { Reader, ReadingAsk } from "../reading.ts";
import { createScenes, momentRequest, sheetOf } from "./sheet.ts";

const ANSWER = {
  place: "The mead hall",
  time: "Night",
  weather: "Rain outside; both soaked",
  light: "Firelight",
  atmosphere: "Warm reds and gold",
  people: [
    {
      name: "Freya",
      appearance: "Gold hair, wet",
      clothes: "Soaked dress",
      action: "By the fire",
      pose: "Sitting on a bench, leaning forward",
      view: "Facing the viewer",
      mood: "Teasing",
      expression: "A sly smile, one eyebrow raised",
    },
  ],
};

function setup(answer: unknown = ANSWER) {
  const db = openDatabase(":memory:");
  const companions = createCompanions(db, "odin", DEFAULT_SETTINGS);
  const companion = companions.save("comp-0001", {
    name: "Freya",
    profile: "Gold hair.",
    settings: { ...DEFAULT_SETTINGS, sceneModel: "claude-sonnet-5-5", sceneEffort: "medium" },
  });
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
  const asks: ReadingAsk[] = [];
  const read: Reader = async (ask) => {
    asks.push(ask);
    return { raw: answer, model: ask.model, cost: 0.002 };
  };
  const scenes = createScenes({ db, read });
  const request = (files: { path: string; content: string; updatedAt: string }[] = []) =>
    momentRequest(companion, { files, pins: [] }, tree.pathTo(reply.id), 1000);
  return { db, tree, asked, reply, asks, scenes, request };
}

describe("working out a moment for a picture", () => {
  it("asks once, on the companion's scene model and effort, with the chat up to the moment, and keeps it", async () => {
    const { reply, asks, scenes, request } = setup();
    const scene = await scenes.of(reply.id, request());
    expect(asks).toHaveLength(1);
    expect(asks[0]!.system).toBe(DEFAULT_PROMPTS.scene);
    expect(asks[0]!.model).toBe("claude-sonnet-5-5");
    expect(asks[0]!.effort).toBe("medium");
    expect(asks[0]!.provider).toBe("anthropic");
    expect(asks[0]!.moment).toContain('<message speaker="The user">\nWet enough?');
    expect(asks[0]!.moment).not.toContain("<lines>");
    expect(scene.sheet.weather).toBe("Rain outside; both soaked");
    expect(scene.sheet.atmosphere).toBe("Warm reds and gold");
    expect(scene.sheet.people[0]!.expression).toBe("A sly smile, one eyebrow raised");
    expect(scene.model).toBe("claude-sonnet-5-5");
    expect(scene.cost).toBe(0.002);

    await scenes.of(reply.id, request());
    expect(asks).toHaveLength(1);
    expect(scenes.peek(reply.id, request())?.sheet).toEqual(scene.sheet);
  });

  it("focuses on the character alone by default", () => {
    expect(DEFAULT_PROMPTS.scene).toContain("the focus should be on the character alone, without the user");
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

  it("keeps your correction, someone added included, also when the chat before changes, until the words do", async () => {
    const { tree, asked, reply, asks, scenes, request } = setup();
    const read = await scenes.of(reply.id, request());
    const user = { ...read.sheet.people[0]!, name: "Eadric", expression: "Dripping, sheepish" };
    const corrected = scenes.save(reply.id, request(), {
      ...read.sheet,
      weather: "Dry: it was the lake",
      people: [...read.sheet.people, user],
    });
    expect(corrected.edited).toBe(true);
    expect(corrected.sheet.weather).toBe("Dry: it was the lake");
    expect(corrected.sheet.people.map((person) => person.name)).toEqual(["Freya", "Eadric"]);

    tree.edit(asked.id, "Soaked enough?");
    expect((await scenes.of(reply.id, request())).sheet.weather).toBe("Dry: it was the lake");
    expect(asks).toHaveLength(1);

    tree.edit(reply.id, "You look fine.");
    expect(scenes.peek(reply.id, request())).toBeNull();
  });

  it("works out one of your messages too", async () => {
    const { tree, asked, asks, scenes, db } = setup();
    const companion = createCompanions(db, "odin", DEFAULT_SETTINGS).get("comp-0001");
    const request = momentRequest(companion, { files: [], pins: [] }, tree.pathTo(asked.id), 1000);
    const scene = await scenes.of(asked.id, request);
    expect(scene.sheet.place).toBe("The mead hall");
    expect(asks[0]!.moment).toContain('<moment speaker="The user">');
  });
});

describe("the scene model's answer", () => {
  it("is left empty where something is missing", () => {
    const sheet = sheetOf({ place: 7, people: [{ name: "Freya" }] });
    expect(sheet.place).toBe("");
    expect(sheet.atmosphere).toBe("");
    expect(sheet.people).toEqual([
      { name: "Freya", appearance: "", clothes: "", action: "", pose: "", view: "", mood: "", expression: "" },
    ]);
  });

  it("reads a sheet kept before atmosphere, expression, pose and view, and drops its lines", () => {
    const sheet = sheetOf({ place: "Hall", people: [{ name: "Freya", mood: "Calm" }], lines: [{ text: "Hi" }] });
    expect(sheet).toEqual({
      place: "Hall",
      time: "",
      weather: "",
      light: "",
      atmosphere: "",
      people: [
        { name: "Freya", appearance: "", clothes: "", action: "", pose: "", view: "", mood: "Calm", expression: "" },
      ],
    });
  });
});
