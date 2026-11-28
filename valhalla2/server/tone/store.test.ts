import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../shared/protocol.ts";
import { DEFAULT_PROMPTS } from "../../shared/prompts.ts";
import { createChats } from "../chat/chats.ts";
import { createCompanions } from "../companions.ts";
import { openDatabase } from "../db.ts";
import type { Reader, ReadingAsk } from "../reading.ts";
import { linesOf } from "../scene/lines.ts";
import { SOUND_NOTE, toneRequest } from "./request.ts";
import { createTones, tonesOf } from "./store.ts";

const ANSWER = {
  lines: [
    { line: 1, feeling: "narration", strength: 1 },
    { line: 2, feeling: "teasing", strength: 3 },
  ],
};

function setup(answer: unknown = ANSWER) {
  const db = openDatabase(":memory:");
  const companions = createCompanions(db, "odin", DEFAULT_SETTINGS);
  // Tags work without memory.
  companions.save("comp-0001", {
    name: "Freya",
    profile: "Gold hair.",
    memory: false,
    settings: { ...DEFAULT_SETTINGS, toneModel: "claude-sonnet-5-5", toneEffort: "medium", toneTokens: 500 },
  });
  const companion = () => companions.get("comp-0001");
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
    return { raw: answer, model: ask.model, cost: 0.0005 };
  };
  const tones = createTones({ db, read });
  const request = () => toneRequest(companion(), tree.pathTo(reply.id));
  return { db, tree, asked, reply, asks, tones, request, companions };
}

describe("how a reply is read aloud", () => {
  it("asks once with the profile, the chat before it and its numbered lines, on the tone settings", async () => {
    const { reply, asks, tones, request } = setup();
    const tone = await tones.of(reply.id, request());
    expect(asks).toHaveLength(1);
    expect(asks[0]!.system).toBe(DEFAULT_PROMPTS.tone);
    expect(asks[0]!.model).toBe("claude-sonnet-5-5");
    expect(asks[0]!.effort).toBe("medium");
    expect(asks[0]!.cacheKey).toBe("tone:comp-0001");
    expect(asks[0]!.background).toContain("Gold hair.");
    expect(asks[0]!.background).not.toContain("<memory>");
    expect(asks[0]!.moment).toContain("1. (action) Wrings out her hair.\n2. (speech) You look like a drowned cat.");
    expect(asks[0]!.moment).toContain('<message speaker="The user">\nWet enough?');
    expect(tone.lines.map((line) => [line.text, line.feeling, line.strength])).toEqual([
      ["Wrings out her hair.", "narration", 1],
      ["You look like a drowned cat.", "teasing", 3],
    ]);
    expect(tone.model).toBe("claude-sonnet-5-5");
    expect(tone.effort).toBe("medium");

    await tones.of(reply.id, request());
    expect(asks).toHaveLength(1);
    expect(tones.peek(reply.id, request())?.lines).toEqual(tone.lines);
  });

  it("asked twice at once, asks once", async () => {
    const { reply, asks, tones, request } = setup();
    await Promise.all([tones.of(reply.id, request()), tones.of(reply.id, request())]);
    expect(asks).toHaveLength(1);
  });

  it("isn't read again when the chat before it changes, only when its words or the instructions do", async () => {
    const { tree, asked, reply, asks, tones, request, companions } = setup();
    await tones.of(reply.id, request());
    tree.edit(asked.id, "Soaked enough?");
    expect(tones.peek(reply.id, request())).not.toBeNull();

    companions.save("comp-0001", { name: "Freya", profile: "Gold hair.", prompts: { tone: "Read it all coldly." } });
    expect(tones.peek(reply.id, request())).toBeNull();
    await tones.of(reply.id, request());
    expect(asks).toHaveLength(2);

    tree.edit(reply.id, "You look fine.");
    expect(tones.peek(reply.id, request())).toBeNull();
  });

  it("reads afresh when asked to", async () => {
    const { reply, asks, tones, request } = setup();
    await tones.of(reply.id, request());
    await tones.of(reply.id, request(), true);
    expect(asks).toHaveLength(2);
  });

  it("keeps your correction until the reply's own words change, whatever the instructions", async () => {
    const { tree, reply, asks, tones, request, companions } = setup();
    const read = await tones.of(reply.id, request());
    const corrected = tones.save(reply.id, request(), {
      lines: read.lines.map((line) => ({ ...line, text: "something else", feeling: "cold", strength: 2 })),
    });
    expect(corrected.edited).toBe(true);
    expect(corrected.lines.map((line) => line.feeling)).toEqual(["cold", "cold"]);
    // The words stay the reply's own, whatever was sent.
    expect(corrected.lines[1]!.text).toBe("You look like a drowned cat.");

    companions.save("comp-0001", { name: "Freya", profile: "Gold hair.", prompts: { tone: "Read it all coldly." } });
    expect((await tones.of(reply.id, request())).edited).toBe(true);
    expect(asks).toHaveLength(1);

    tree.edit(reply.id, "You look fine.");
    expect(tones.peek(reply.id, request())).toBeNull();
  });

  it("refuses a correction whose lines no longer match, or with an unknown feeling", async () => {
    const { reply, tones, request } = setup();
    const read = await tones.of(reply.id, request());
    expect(() => tones.save(reply.id, request(), { lines: [] })).toThrow(/don't match/);
    expect(() =>
      tones.save(reply.id, request(), { lines: read.lines.map((line) => ({ ...line, feeling: "smug" })) }),
    ).toThrow(/feeling/);
  });

  it("refuses one of your messages: only replies are read aloud", () => {
    const { tree, asked, companions } = setup();
    expect(() => toneRequest(companions.get("comp-0001"), tree.pathTo(asked.id))).toThrow(/replies/);
  });

  it("lists the replies of a chat whose tags still match their words", async () => {
    const { tree, reply, tones, request } = setup();
    expect(tones.keptIn("chat-0001")).toEqual([]);
    await tones.of(reply.id, request());
    expect(tones.keptIn("chat-0001")).toEqual([reply.id]);
    tree.edit(reply.id, "You look fine.");
    expect(tones.keptIn("chat-0001")).toEqual([]);
  });
});

describe("the tone model's answer", () => {
  it("is read plainly where something is missing or unknown", () => {
    const lines = linesOf("*Nods.* Yes. No.");
    expect(
      tonesOf({ lines: [{ line: 2, feeling: "smug", strength: 9 }] }, lines).map((line) => [
        line.feeling,
        line.strength,
      ]),
    ).toEqual([
      ["narration", 2],
      ["neutral", 2],
      ["neutral", 2],
    ]);
  });
});

describe("sounds, for a Grok voice", () => {
  const WITH_SOUNDS = {
    lines: [
      { line: 1, feeling: "narration", strength: 1, sound: "sigh" },
      { line: 2, feeling: "teasing", strength: 3, sound: "chuckle" },
    ],
  };

  it("asks for them only for a Grok voice, with the note after the instructions", async () => {
    const { reply, asks, tones, companions, tree } = setup(WITH_SOUNDS);
    const request = toneRequest(companions.get("comp-0001"), tree.pathTo(reply.id), true);
    const tone = await tones.of(reply.id, request);
    expect(asks[0]!.system).toBe(`${DEFAULT_PROMPTS.tone}\n\n${SOUND_NOTE}`);
    expect(asks[0]!.cacheKey).toBe("tone:comp-0001:sounds");
    expect(JSON.stringify(asks[0]!.schema)).toContain('"sound"');
    expect(tone.sounds).toBe(true);
    expect(tone.lines.map((line) => line.sound)).toEqual(["sigh", "chuckle"]);
  });

  it("keeps none from an answer that wasn't asked for them, and reads the tags again for a Grok voice", async () => {
    const { reply, asks, tones, request, companions, tree } = setup(WITH_SOUNDS);
    const azure = await tones.of(reply.id, request());
    expect(JSON.stringify(asks[0]!.schema)).not.toContain('"sound"');
    expect(azure.sounds).toBe(false);
    expect(azure.lines.map((line) => line.sound)).toEqual([null, null]);
    await tones.of(reply.id, toneRequest(companions.get("comp-0001"), tree.pathTo(reply.id), true));
    expect(asks).toHaveLength(2);
  });

  it("takes a corrected sound, refuses an unknown one, and reads old lines without one as none", async () => {
    const { db, reply, tones, companions, tree } = setup(WITH_SOUNDS);
    const request = toneRequest(companions.get("comp-0001"), tree.pathTo(reply.id), true);
    const tone = await tones.of(reply.id, request);
    const changed = tone.lines.map((line, at) => ({ ...line, sound: at === 0 ? null : "laugh" }));
    expect(tones.save(reply.id, request, { lines: changed }).lines.map((line) => line.sound)).toEqual([null, "laugh"]);
    const unknown = tone.lines.map((line) => ({ ...line, sound: "burp" }));
    expect(() => tones.save(reply.id, request, { lines: unknown })).toThrow(/sound isn't valid/);

    const old = tone.lines.map(({ sound: _sound, ...line }) => line);
    db.prepare("UPDATE tones SET lines = ? WHERE message_id = ?").run(JSON.stringify(old), reply.id);
    expect(tones.peek(reply.id, request)?.lines.map((line) => line.sound)).toEqual([null, null]);
  });

  it("finds sounds only when they were asked for", () => {
    const lines = linesOf("*Smiles.* Hi.");
    expect(tonesOf(WITH_SOUNDS, lines, true).map((line) => line.sound)).toEqual(["sigh", "chuckle"]);
    expect(tonesOf(WITH_SOUNDS, lines).map((line) => line.sound)).toEqual([null, null]);
    expect(tonesOf({ lines: [{ line: 1, sound: "burp" }] }, lines, true).map((line) => line.sound)).toEqual([
      null,
      null,
    ]);
  });
});
