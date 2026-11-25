import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS } from "../../shared/protocol.ts";
import { createChats } from "../chat/chats.ts";
import { createCompanions } from "../companions.ts";
import { openDatabase } from "../db.ts";
import { StoreError } from "../errors.ts";
import { createFileStore } from "../files.ts";
import type { AzureSpeech } from "./azure.ts";
import {
  charsThisMonth,
  createSpeech,
  forgetDeletedSpeech,
  knownSpeechFiles,
  ownsSpeech,
  speechFilesOf,
  SPEECH_FILE,
} from "./store.ts";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const MP3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0]);

function setup(voice = "en-US-AvaMultilingualNeural") {
  const db = openDatabase(":memory:");
  const companions = createCompanions(db, "odin", DEFAULT_SETTINGS);
  companions.save("comp-0001", { name: "Freya", profile: "Gold hair." });
  const chats = createChats(db, "odin", companions, 5);
  chats.create({ id: "chat-0001", companionId: "comp-0001" });
  const tree = chats.tree("chat-0001");
  const hello = tree.add({ parentId: null, role: "assistant", content: [{ type: "text", text: "*Waves.* Hello." }] });
  const mine = tree.add({ parentId: hello.id, role: "user", content: [{ type: "text", text: "Hi." }] });
  tree.setLeaf(mine.id);

  const dir = mkdtempSync(join(tmpdir(), "valhalla2-speech-"));
  made.push(dir);
  const files = createFileStore(dir);
  const read: string[] = [];
  const azure: AzureSpeech = {
    synthesize: async (ssml: string) => {
      read.push(ssml);
      return MP3;
    },
  };
  return { db, chats, tree, hello, mine, dir, files, read, speech: createSpeech({ db, azure, files, voice }) };
}

describe("reading aloud", () => {
  it("reads a reply once, keeps the file, and plays the kept one after that", async () => {
    const { db, tree, hello, dir, read, speech } = setup();
    const first = await speech.of(tree.get(hello.id));
    expect(first.read).toBe("Waves. Hello.".length);
    expect(first.file).toMatch(SPEECH_FILE);
    expect(readdirSync(dir)).toEqual([first.file]);
    expect(read[0]).toContain(">Waves. Hello.</voice>");

    const again = await speech.of(tree.get(hello.id));
    expect(again).toEqual({ file: first.file, read: 0 });
    expect(read).toHaveLength(1);
    expect(charsThisMonth(db)).toBe(13);
  });

  it("asked twice at once, reads once", async () => {
    const { tree, hello, read, speech } = setup();
    const [a, b] = await Promise.all([speech.of(tree.get(hello.id)), speech.of(tree.get(hello.id))]);
    expect(a.file).toBe(b.file);
    expect(read).toHaveLength(1);
  });

  it("reads an edited reply again and deletes the old audio", async () => {
    const { db, tree, hello, dir, read, speech } = setup();
    const before = await speech.of(tree.get(hello.id));
    tree.edit(hello.id, "Good evening.");
    const after = await speech.of(tree.get(hello.id));
    expect(after.file).not.toBe(before.file);
    expect(read).toHaveLength(2);
    expect(readdirSync(dir)).toEqual([after.file]);
    expect(knownSpeechFiles(db)).toEqual(new Set([after.file]));
    // Both readings were paid for.
    expect(charsThisMonth(db)).toBe("Waves. Hello.".length + "Good evening.".length);
  });

  it("reads another voice again", async () => {
    const first = setup("en-US-AvaMultilingualNeural");
    const kept = await first.speech.of(first.tree.get(first.hello.id));
    const other = createSpeech({
      db: first.db,
      azure: { synthesize: async () => MP3 },
      files: first.files,
      voice: "pt-BR-FranciscaNeural",
    });
    const changed = await other.of(first.tree.get(first.hello.id));
    expect(changed.read).toBeGreaterThan(0);
    expect(changed.file).not.toBe(kept.file);
    expect(existsSync(join(first.dir, kept.file))).toBe(false);
  });

  it("reads only a companion's replies, and only ones with words", async () => {
    const { tree, hello, mine, speech } = setup();
    await expect(speech.of(tree.get(mine.id))).rejects.toBeInstanceOf(StoreError);
    tree.edit(hello.id, "* *");
    await expect(speech.of(tree.get(hello.id))).rejects.toThrow(/nothing to read/);
  });

  it("keeps nothing when Azure fails", async () => {
    const { db, tree, hello, dir, files } = setup();
    const failing = createSpeech({
      db,
      azure: { synthesize: () => Promise.reject(new Error("down")) },
      files,
      voice: "v",
    });
    await expect(failing.of(tree.get(hello.id))).rejects.toThrow("down");
    expect(readdirSync(dir)).toEqual([]);
    expect(charsThisMonth(db)).toBe(0);
  });

  it("serves a file only to its owner", async () => {
    const { db, tree, hello, speech } = setup();
    const { file } = await speech.of(tree.get(hello.id));
    expect(ownsSpeech(db, "odin", file)).toBe(true);
    expect(ownsSpeech(db, "freya", file)).toBe(false);
    expect(ownsSpeech(db, "odin", "../valhalla2.db")).toBe(false);
  });

  it("names the files of a chat and of a companion, and forgets them with the chat", async () => {
    const { db, chats, tree, hello, speech } = setup();
    const { file } = await speech.of(tree.get(hello.id));
    expect(speechFilesOf(db, { chatId: "chat-0001" })).toEqual([file]);
    expect(speechFilesOf(db, { companionId: "comp-0001" })).toEqual([file]);
    chats.remove("chat-0001");
    expect(knownSpeechFiles(db).size).toBe(0);
  });

  it("forgets the audio of a deleted message, and only that", async () => {
    const { db, tree, hello, speech } = setup();
    const { file } = await speech.of(tree.get(hello.id));
    expect(forgetDeletedSpeech(db, "chat-0001")).toEqual([]);
    tree.remove(hello.id);
    expect(forgetDeletedSpeech(db, "chat-0001")).toEqual([file]);
    expect(knownSpeechFiles(db).size).toBe(0);
  });
});
