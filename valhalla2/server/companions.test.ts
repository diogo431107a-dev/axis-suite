import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Response } from "openai/resources/responses/responses";
import { DEFAULT_SETTINGS, blockText, hasScenes, type Message } from "../shared/protocol.ts";
import { createChats } from "./chat/chats.ts";
import { chatWindow } from "./chat/write.ts";
import { config } from "./config.ts";
import { prepare } from "./chat/turn.ts";
import { createCompanions, needMemory, needScenes } from "./companions.ts";
import { openDatabase } from "./db.ts";
import { StoreError } from "./errors.ts";
import { grokDraftOf, pictureRequestFor } from "./grok/pictures.ts";
import { tokensOf, windowWithout } from "./memory/history.ts";
import { runStep } from "./memory/run.ts";
import { createScheduler } from "./memory/scheduler.ts";
import { createMemory } from "./memory/store.ts";
import { createPins } from "./pins.ts";
import { asParams } from "./prompt.ts";
import { plainPictureRequest } from "./scene/context.ts";

const LIMITS = { fileBytes: 8192, storyBytes: 16384, files: 20, viewChars: 16_000 };
const grok = { ...DEFAULT_SETTINGS, model: "grok-4.7" };

function setup() {
  const db = openDatabase(":memory:");
  const companions = createCompanions(db, "odin", DEFAULT_SETTINGS);
  return { db, companions };
}

describe("Claude or Grok, with or without memory", () => {
  it("takes both from a new companion: with memory unless told otherwise", () => {
    const { companions } = setup();
    expect(companions.save("comp-0001", { name: "Hrothgar" })).toMatchObject({ provider: "anthropic", memory: true });
    expect(companions.save("comp-0002", { name: "Wealhtheow", memory: false })).toMatchObject({
      provider: "anthropic",
      memory: false,
    });
    expect(companions.save("comp-0003", { name: "Grendel", settings: grok })).toMatchObject({
      provider: "xai",
      memory: true,
      settings: { model: "grok-4.7", memoryModel: "grok-4.7", temperature: null },
    });
    expect(companions.save("comp-0004", { name: "Grendel", settings: grok, memory: false })).toMatchObject({
      provider: "xai",
      memory: false,
    });
  });

  it("gives a Grok companion with memory its files, and one without none", () => {
    const { db, companions } = setup();
    companions.save("comp-0001", { name: "Grendel", settings: grok, memory: true });
    companions.save("comp-0002", { name: "Grendel", settings: grok, memory: false });
    expect(createMemory(db, LIMITS).files("comp-0001").length).toBeGreaterThan(0);
    expect(createMemory(db, LIMITS).files("comp-0002")).toEqual([]);
  });

  it("sends a Grok companion with memory a larger window than a Claude one", async () => {
    const { companions } = setup();
    const claude = companions.save("comp-0001", { name: "Hrothgar" });
    const grokWith = companions.save("comp-0002", { name: "Grendel", settings: grok, memory: true });
    expect(await chatWindow(claude)).toEqual({ tokens: config.windowTokens, chunk: config.windowChunk });
    expect(await chatWindow(grokWith)).toEqual({ tokens: config.grokWindowTokens, chunk: config.windowChunk });
    expect(config.grokWindowTokens).toBeGreaterThan(config.windowTokens);
  });

  it("gives scenes to a companion with memory, Claude or Grok", () => {
    const { companions } = setup();
    const claude = companions.save("comp-0001", { name: "Hrothgar" });
    const without = companions.save("comp-0002", { name: "Wealhtheow", memory: false });
    const grokWith = companions.save("comp-0003", { name: "Grendel", settings: grok, memory: true });
    expect(needScenes(claude)).toBe(claude);
    expect(() => needScenes(without)).toThrow(/no scenes/);
    expect(needScenes(grokWith)).toBe(grokWith);
    expect(hasScenes(grokWith)).toBe(true);
  });

  it("reads tags and scenes on the companion's own API", () => {
    const { companions } = setup();
    const grokWith = companions.save("comp-0001", { name: "Grendel", settings: grok, memory: true });
    expect(grokWith.settings).toMatchObject({
      toneModel: "grok-4.7",
      sceneModel: "grok-4.7",
      toneEffort: "low",
      sceneEffort: "low",
    });
    const claude = companions.save("comp-0002", {
      name: "Hrothgar",
      settings: { ...DEFAULT_SETTINGS, toneModel: "claude-sonnet-5-5", sceneEffort: "high", toneTokens: 2000 },
    });
    expect(claude.settings).toMatchObject({ toneModel: "claude-sonnet-5-5", sceneEffort: "high", toneTokens: 2000 });
    expect(() =>
      companions.save("comp-0002", { name: "Hrothgar", settings: { ...DEFAULT_SETTINGS, sceneModel: "grok-4.7" } }),
    ).toThrow(/scene model has to be a Claude model/);
    expect(() =>
      companions.save("comp-0002", { name: "Hrothgar", settings: { ...DEFAULT_SETTINGS, toneTokens: 50 } }),
    ).toThrow(/How much of the chat/);
  });

  it("lets a Claude companion move between Claude models, never to Grok", () => {
    const { companions } = setup();
    companions.save("comp-0001", { name: "Hrothgar", settings: { model: "claude-haiku-5-5" } });
    expect(
      companions.save("comp-0001", { name: "Hrothgar", settings: { model: "claude-opus-5-5" } }).settings.model,
    ).toBe("claude-opus-5-5");
    expect(() => companions.save("comp-0001", { name: "Hrothgar", settings: grok })).toThrow(StoreError);
    expect(companions.get("comp-0001").settings.model).toBe("claude-opus-5-5");
  });

  it("keeps a Grok companion on Grok", () => {
    const { companions } = setup();
    companions.save("comp-0001", { name: "Grendel", settings: grok });
    expect(() => companions.save("comp-0001", { name: "Grendel", settings: { model: "claude-opus-5-5" } })).toThrow(
      /talks to Grok/,
    );
    // As the page sends it: every setting, the memory model still Grok's.
    const saved = companions.get("comp-0001").settings;
    expect(() =>
      companions.save("comp-0001", { name: "Grendel", settings: { ...saved, model: "claude-opus-5-5" } }),
    ).toThrow(/talks to Grok/);
    expect(companions.save("comp-0001", { name: "Grendel", settings: { ...grok, temperature: 0.4 } })).toMatchObject({
      provider: "xai",
      settings: { temperature: 0.4 },
    });
  });

  it("never changes whether a companion has memory", () => {
    const { companions } = setup();
    companions.save("comp-0001", { name: "Hrothgar" });
    companions.save("comp-0002", { name: "Wealhtheow", memory: false });
    expect(() => companions.save("comp-0001", { name: "Hrothgar", memory: false })).toThrow(/chosen when/);
    expect(() => companions.save("comp-0002", { name: "Wealhtheow", memory: true })).toThrow(/chosen when/);
    // Saying the same again, or nothing, is fine.
    expect(companions.save("comp-0001", { name: "Hrothgar", memory: true }).memory).toBe(true);
    expect(companions.save("comp-0002", { name: "Wealhtheow" }).memory).toBe(false);
  });

  it("refuses what needs memory to a companion without it", () => {
    const { companions } = setup();
    const without = companions.save("comp-0001", { name: "Wealhtheow", memory: false });
    expect(() => needMemory(without)).toThrow("This companion has no memory");
    const withMemory = companions.save("comp-0002", { name: "Hrothgar" });
    expect(needMemory(withMemory)).toBe(withMemory);
  });
});

describe("companions from before the choice existed", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("become Claude companions with memory, with no temperature, reading tags and scenes on Haiku", () => {
    const dir = mkdtempSync(join(tmpdir(), "valhalla2-migrate-"));
    made.push(dir);
    const file = join(dir, "valhalla2.db");
    const old = openDatabase(file, 9);
    const { temperature: _dropped, ...oldSettings } = DEFAULT_SETTINGS;
    old
      .prepare(
        `INSERT INTO companions (id, name, profile, settings, prompts, voice, voice_feeling, created_at, updated_at, owner)
         VALUES ('comp-0001', 'Hrothgar', '', ?, '{}', NULL, 1, 'then', 'then', 'odin')`,
      )
      .run(JSON.stringify(oldSettings));
    old.close();
    const db = openDatabase(file);
    expect(createCompanions(db, "odin", DEFAULT_SETTINGS).get("comp-0001")).toMatchObject({
      provider: "anthropic",
      memory: true,
      settings: {
        temperature: null,
        toneModel: config.defaults.toneModel,
        toneEffort: "low",
        toneTokens: 4000,
        sceneModel: config.defaults.sceneModel,
        sceneEffort: "low",
      },
      voiceTuning: { rate: 0, pitch: 0, style: null },
    });
    db.close();
  });

  it("keep how their replies were already read aloud, as tags apart from the scene", () => {
    const dir = mkdtempSync(join(tmpdir(), "valhalla2-migrate-"));
    made.push(dir);
    const file = join(dir, "valhalla2.db");
    const old = openDatabase(file, 11);
    old.exec(`
      INSERT INTO companions (id, name, profile, settings, prompts, created_at, updated_at, owner)
        VALUES ('comp-0001', 'Freya', '', '{"model":"claude-haiku-5-5"}', '{}', 'then', 'then', 'odin');
      INSERT INTO chats (id, companion_id, title, created_at, last_activity_at)
        VALUES ('chat-0001', 'comp-0001', 'The hall', 'then', 'then');
      INSERT INTO messages (id, chat_id, role, content, created_at)
        VALUES (1, 'chat-0001', 'assistant', '[{"type":"text","text":"Hi."}]', 'then'),
               (2, 'chat-0001', 'user', '[{"type":"text","text":"Hello."}]', 'then');
    `);
    const line = { text: "Hi.", action: false, paragraph: true, feeling: "warm", strength: 2 };
    const insert = old.prepare(
      `INSERT INTO scenes (message_id, context_hash, text_hash, sheet, model, cost, request, created_at, edited_at)
       VALUES (?, 'c', ?, ?, 'claude-haiku-5-5', 0.002, '{"system":"","prompt":""}', 'then', ?)`,
    );
    insert.run(1, "t1", JSON.stringify({ place: "Hall", people: [], lines: [line] }), "fixed");
    insert.run(2, "t2", JSON.stringify({ place: "Hall", people: [], lines: [] }), null);
    old.close();

    const db = openDatabase(file);
    const tones = db.prepare("SELECT * FROM tones").all() as Record<string, unknown>[];
    expect(tones).toHaveLength(1);
    expect(tones[0]).toMatchObject({ message_id: 1, text_hash: "t1", effort: "low", edited_at: "fixed", cost: 0.002 });
    expect(JSON.parse(tones[0]!.lines as string)).toEqual([line]);
    db.close();
  });
});

describe("a chat without memory", () => {
  function chatWithout(settings = DEFAULT_SETTINGS) {
    const { db, companions } = setup();
    const companion = companions.save("comp-0001", {
      name: "Grendel",
      profile: "<personality>Hungry.</personality>",
      settings,
      memory: false,
    });
    const chats = createChats(db, "odin", companions, 5);
    chats.create({ id: "chat-0001", companionId: companion.id, title: "The hall" });
    const tree = chats.tree("chat-0001");
    let parent: number | null = null;
    const path: Message[] = [];
    for (let n = 0; n < 40; n++) {
      const message = tree.add({
        parentId: parent,
        role: n % 2 === 0 ? "assistant" : "user",
        content: [{ type: "text", text: `Line ${n}: ${"word ".repeat(200)}` }],
        isGreeting: n === 0,
      });
      path.push(message);
      parent = message.id;
    }
    tree.setLeaf(parent!);
    const base = {
      db,
      chatId: "chat-0001",
      companion,
      memory: createMemory(db, LIMITS),
      // About 10K tokens of chat, well inside a window sized as chatWindow sizes it.
      window: { tokens: 100_000, chunk: 2, slideTo: 75_000 },
    };
    return { db, companions, chats, tree, path, base, companion };
  }

  const windowStart = (db: ReturnType<typeof setup>["db"]) =>
    (db.prepare("SELECT window_start FROM chats WHERE id = 'chat-0001'").get() as { window_start: number | null })
      .window_start;
  const said = (messages: { content: unknown; hidden: boolean }[]) =>
    messages.filter((message) => !message.hidden).map((message) => JSON.stringify(message.content));

  it("sends the whole chat, after the profile alone, while it fits the window", async () => {
    const { db, path, base } = chatWithout(grok);
    const { system, messages } = await prepare(base, path, undefined, true);
    expect(system.map((block) => block.text)).toEqual(["<personality>Hungry.</personality>"]);
    expect(messages.filter((message) => !message.hidden)).toHaveLength(40);
    expect(windowStart(db)).toBeNull();
  });

  it("slides its oldest turns out once over the window, down to slideTo, telling nobody", async () => {
    const { db, path, base } = chatWithout(grok);
    let slides = 0;
    const small = { ...base, window: { tokens: 8_000, chunk: 2, slideTo: 4_000 }, onSlide: async () => void slides++ };
    const { messages } = await prepare(small, path, undefined, true);
    const sent = path.slice(path.findIndex((message) => message.id === windowStart(db)));
    expect(sent[0]!.role).toBe("user");
    expect(said(messages)).toEqual(sent.map((message) => JSON.stringify(message.content)));
    // Down to slideTo, not just under the budget: the next slide is many turns away.
    expect(sent.reduce((sum, message) => sum + tokensOf(message), 0)).toBeLessThanOrEqual(4_000);
    expect(sent.length).toBeLessThan(40);
    // No memory to fold what slid out into.
    expect(slides).toBe(0);
  });

  it("starts in the same place on the next turns, until it is over the window again", async () => {
    const { db, tree, path, base } = chatWithout(grok);
    const small = { ...base, window: { tokens: 8_000, chunk: 2, slideTo: 4_000 } };
    await prepare(small, path, undefined, true);
    const first = windowStart(db);
    let parent = path.at(-1)!.id;
    for (let n = 0; n < 4; n++) {
      const message = tree.add({
        parentId: parent,
        role: n % 2 === 0 ? "assistant" : "user",
        content: [{ type: "text", text: `More ${n}: ${"word ".repeat(200)}` }],
      });
      path.push(message);
      parent = message.id;
    }
    await prepare(small, path, undefined, true);
    expect(windowStart(db)).toBe(first);
    for (let n = 0; n < 30; n++) {
      const message = tree.add({
        parentId: parent,
        role: n % 2 === 0 ? "assistant" : "user",
        content: [{ type: "text", text: `Later ${n}: ${"word ".repeat(200)}` }],
      });
      path.push(message);
      parent = message.id;
    }
    await prepare(small, path, undefined, true);
    expect(windowStart(db)).not.toBe(first);
  });

  it("keeps nothing when only looked at (Inspect, the token count)", async () => {
    const { db, path, base } = chatWithout(grok);
    const small = { ...base, window: { tokens: 8_000, chunk: 2, slideTo: 4_000 } };
    const looked = await prepare(small, path, undefined, false);
    expect(windowStart(db)).toBeNull();
    expect(said(looked.messages)).toEqual(said((await prepare(small, path, undefined, true)).messages));
  });

  it("is sized under 200K tokens, or under a smaller model window less the reply", () => {
    expect(windowWithout(500_000, 16_000)).toEqual({ tokens: 160_000, slideTo: 120_000 });
    expect(windowWithout(null, 16_000)).toEqual({ tokens: 160_000, slideTo: 120_000 });
    expect(windowWithout(128_000, 8_000)).toEqual({ tokens: 96_000, slideTo: 72_000 });
  });

  it("sends the pins after the profile, from the next turn", async () => {
    const { db, chats, path, base, companions } = chatWithout(grok);
    createPins(db, "odin", chats).add("chat-0001", {
      messageId: path[2]!.id,
      speaker: "Grendel",
      text: "The hall is too loud.",
    });
    const { system } = await prepare({ ...base, companion: companions.get("comp-0001") }, path, undefined, false);
    expect(system).toHaveLength(2);
    expect(system[1]!.text).toContain("<pinned_moments>");
    expect(system[1]!.text).toContain('"The hall is too loud."');
    expect(system[1]!.text).not.toContain("<memory>");
    expect(system[1]!.cache_control).toBeDefined();
    expect(asParams((await prepare(base, path, undefined, false)).messages)).toHaveLength(41);
  });

  it("is never folded into memory, by the scheduler or by anyone", async () => {
    const { db, base, companion } = chatWithout();
    db.prepare("UPDATE chats SET last_activity_at = '2026-01-01T00:00:00.000Z'").run();
    let ran = 0;
    const deps = {
      db,
      memory: base.memory,
      limits: LIMITS,
      run: () => {
        ran++;
        return Promise.reject(new Error("never"));
      },
      maxIterations: 8,
    };
    const scheduler = createScheduler({
      ...deps,
      idleMinutes: 30,
      cleanup: { every: 10, days: 7 },
      partTokens: 20_000,
    });
    expect(scheduler.sweep()).toEqual([]);
    expect(await scheduler.now("chat-0001")).toMatchObject({ kind: "nothing", reason: "This companion has no memory" });
    expect(await scheduler.tidy(companion.id)).toMatchObject({ kind: "nothing" });
    expect(await scheduler.rebuild(companion.id)).toMatchObject({ kind: "nothing" });
    await expect(
      runStep(deps, {
        companion,
        kind: "consolidate",
        chatId: "chat-0001",
        work: companion.id,
        source: "test",
        mode: "canon",
        system: "",
        prompt: "",
      }),
    ).rejects.toThrow(/has no memory/);
    expect(ran).toBe(0);
  });

  it("never runs a memory model of the other API", async () => {
    const { db, companions } = setup();
    const companion = companions.save("comp-0009", { name: "Grendel", settings: grok, memory: true });
    let ran = 0;
    const deps = {
      db,
      memory: createMemory(db, LIMITS),
      limits: LIMITS,
      run: () => {
        ran++;
        return Promise.reject(new Error("never"));
      },
      maxIterations: 8,
    };
    const spec = {
      kind: "consolidate" as const,
      chatId: null,
      work: companion.id,
      source: "test",
      mode: "canon" as const,
      system: "",
      prompt: "",
    };
    const toClaude = { ...companion, settings: { ...companion.settings, memoryModel: "claude-sonnet-5-5" } };
    await expect(runStep(deps, { ...spec, companion: toClaude })).rejects.toThrow(/isn't a model of/);
    expect(ran).toBe(0);
  });

  it("says memory has nothing pending", () => {
    const { chats } = chatWithout();
    expect(chats.page("chat-0001").memoryPending).toBe(false);
  });
});

describe("a picture without memory", () => {
  const companion = {
    ...createCompanions(openDatabase(":memory:"), "odin", DEFAULT_SETTINGS).save("comp-0001", {
      name: "Grendel",
      profile: "<appearance>Huge.</appearance>",
      settings: grok,
      memory: false,
    }),
  };
  const said = (id: number, role: "user" | "assistant", text: string): Message => ({
    id,
    parentId: id - 1 || null,
    role,
    content: [{ type: "text", text }],
    instruction: null,
    isGreeting: false,
    at: "now",
    editedAt: null,
    reply: null,
  });

  it("reads the profile and that one message, nothing before it", () => {
    const request = plainPictureRequest(
      companion,
      {
        kind: "chat",
        path: [
          said(1, "assistant", "The mere is cold."),
          said(2, "user", "I wade in."),
          said(3, "assistant", "I rise from the water."),
        ],
      },
      "at night",
    );
    expect(request.prompt).toContain("<appearance>Huge.</appearance>");
    expect(request.prompt).toContain("I rise from the water.");
    expect(request.prompt).not.toContain("I wade in.");
    expect(request.prompt).not.toContain("The mere is cold.");
    expect(request.prompt).not.toContain("<memory>");
    expect(request.prompt).toContain("The user's note for this picture: at night");
  });

  it("goes to Grok for a Grok companion, in Grok's structured-output shape", () => {
    const request = pictureRequestFor({ system: "Paint.", prompt: "A moment." }, "grok-4.7");
    expect(request).toMatchObject({
      model: "grok-4.7",
      store: false,
      text: { format: { type: "json_schema", strict: true } },
    });
    const response = {
      model: "grok-4.7",
      status: "completed",
      incomplete_details: null,
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                prompt: "a giant",
                negativePrompt: "",
                orientation: "landscape",
                caption: "Grendel",
              }),
            },
          ],
        },
      ],
      usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens: 50 },
    } as unknown as Response;
    expect(grokDraftOf(response, "grok-4.7")).toMatchObject({ prompt: "a giant", orientation: "landscape" });
    expect(() =>
      grokDraftOf(
        { ...response, status: "incomplete", incomplete_details: { reason: "content_filter" } } as Response,
        "grok-4.7",
      ),
    ).toThrow(/Grok declined/);
    void blockText;
  });
});

describe("a companion's voice speed, pitch and style", () => {
  it("is the voice's usual unless set, and kept as set", () => {
    const { companions } = setup();
    expect(companions.save("comp-0001", { name: "Freya" }).voiceTuning).toEqual({ rate: 0, pitch: 0, style: null });
    const tuning = { rate: 15, pitch: -6, style: "chat" };
    expect(companions.save("comp-0001", { name: "Freya", voiceTuning: tuning }).voiceTuning).toEqual(tuning);
    expect(companions.get("comp-0001").voiceTuning).toEqual(tuning);
    expect(companions.save("comp-0001", { name: "Freya", voiceTuning: { style: "" } }).voiceTuning).toEqual({
      rate: 0,
      pitch: 0,
      style: null,
    });
  });

  it("refuses what Azure doesn't take", () => {
    const { companions } = setup();
    expect(() => companions.save("comp-0001", { name: "Freya", voiceTuning: { rate: 101 } })).toThrow(/speed/);
    expect(() => companions.save("comp-0001", { name: "Freya", voiceTuning: { pitch: -51 } })).toThrow(/pitch/);
    expect(() => companions.save("comp-0001", { name: "Freya", voiceTuning: { rate: 2.5 } })).toThrow(/whole/);
    expect(() => companions.save("comp-0001", { name: "Freya", voiceTuning: { style: '"><x' } })).toThrow(/style/);
  });
});

describe("Picture settings", () => {
  it("start from the defaults, are checked, and keep the seed of the last picture", () => {
    const { db, companions } = setup();
    expect(companions.save("comp-0001", { name: "Freya" }).settings).toMatchObject({
      pictureSteps: 20,
      pictureCfg: 7,
      pictureSampler: "euler_a",
      pictureClipSkip: 2,
      pictureSeed: null,
    });
    const settings = {
      ...DEFAULT_SETTINGS,
      pictureSteps: 28,
      pictureCfg: 5.5,
      pictureSampler: "dpm++2m",
      pictureSeed: 9_999_999_999,
    };
    expect(companions.save("comp-0001", { name: "Freya", settings }).settings).toMatchObject({
      pictureSteps: 28,
      pictureCfg: 5.5,
      pictureSampler: "dpm++2m",
      pictureSeed: 9_999_999_999,
    });
    const refused = (fields: Record<string, unknown>) =>
      expect(() =>
        companions.save("comp-0001", { name: "Freya", settings: { ...DEFAULT_SETTINGS, ...fields } }),
      ).toThrow(StoreError);
    refused({ pictureSteps: 61 });
    refused({ pictureCfg: 7.25 });
    refused({ pictureSampler: "dpm++3m" });
    refused({ pictureClipSkip: 4 });
    refused({ pictureSeed: 10_000_000_000 });

    const before = companions.get("comp-0001");
    companions.setPictureSeed("comp-0001", 1_234_567_890);
    const after = companions.get("comp-0001");
    expect(after.settings).toEqual({ ...before.settings, pictureSeed: 1_234_567_890 });
    expect(after.updatedAt).toBe(before.updatedAt);
    // Another person's companion is left alone.
    createCompanions(db, "freya", DEFAULT_SETTINGS).setPictureSeed("comp-0001", 1);
    expect(companions.get("comp-0001").settings.pictureSeed).toBe(1_234_567_890);
  });

  it("are filled in for a companion saved before they existed", () => {
    const { db, companions } = setup();
    companions.save("comp-0001", { name: "Freya" });
    const {
      pictureSteps: _s,
      pictureCfg: _c,
      pictureSampler: _m,
      pictureClipSkip: _k,
      pictureSeed: _d,
      ...old
    } = companions.get("comp-0001").settings;
    db.prepare("UPDATE companions SET settings = ? WHERE id = ?").run(JSON.stringify(old), "comp-0001");
    expect(companions.get("comp-0001").settings).toMatchObject({ pictureSteps: 20, pictureSeed: null });
  });
});
