import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS, type Voice } from "../../shared/protocol.ts";
import { createChats } from "../chat/chats.ts";
import { createCompanions } from "../companions.ts";
import { openDatabase } from "../db.ts";
import { StoreError } from "../errors.ts";
import { createFileStore } from "../files.ts";
import { linesOf } from "../scene/lines.ts";
import type { AzureSpeech } from "./azure.ts";
import { azureVoice, grokVoice } from "./engine.ts";
import type { GrokReading, GrokSpeech } from "./grok.ts";
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
const VOICE: Voice = {
  id: "pt-BR-FranciscaNeural",
  engine: "azure",
  name: "Francisca",
  locale: "pt-BR",
  language: "Portuguese (Brazil)",
  gender: "Female",
  multilingual: false,
  styles: ["calm"],
};

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
    voices: async () => {
      read.push("voices");
      return [VOICE];
    },
  };
  return {
    db,
    chats,
    tree,
    hello,
    mine,
    dir,
    files,
    read,
    speech: createSpeech({ db, engines: { azure: azureVoice(azure) }, files, voice }),
  };
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
    expect(again).toEqual({ file: first.file, engine: "azure", read: 0 });
    expect(read).toHaveLength(1);
    expect(charsThisMonth(db, "azure")).toBe(13);
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
    expect(charsThisMonth(db, "azure")).toBe("Waves. Hello.".length + "Good evening.".length);
  });

  it("reads another voice again", async () => {
    const first = setup("en-US-AvaMultilingualNeural");
    const kept = await first.speech.of(first.tree.get(first.hello.id));
    const other = createSpeech({
      db: first.db,
      engines: { azure: azureVoice({ synthesize: async () => MP3, voices: async () => [] }) },
      files: first.files,
      voice: "pt-BR-FranciscaNeural",
    });
    const changed = await other.of(first.tree.get(first.hello.id));
    expect(changed.read).toBeGreaterThan(0);
    expect(changed.file).not.toBe(kept.file);
    expect(existsSync(join(first.dir, kept.file))).toBe(false);
  });

  it("reads in the companion's own voice when it has one", async () => {
    const { tree, hello, read, speech } = setup("en-US-AvaMultilingualNeural");
    const own = await speech.of(tree.get(hello.id), "pt-BR-FranciscaNeural");
    expect(read[0]).toContain('<voice name="pt-BR-FranciscaNeural">');
    expect(read[0]).toContain('xml:lang="pt-BR"');
    // The server's voice is another reading, which replaces it.
    const server = await speech.of(tree.get(hello.id));
    expect(server.file).not.toBe(own.file);
    expect(read[1]).toContain('<voice name="en-US-AvaMultilingualNeural">');
  });

  it("reads each line the way the scene says, in the voice's own style where it has one", async () => {
    const { tree, hello, read, speech } = setup();
    const lines = linesOf("*Waves.* Hello.").map((line, at) => ({
      ...line,
      feeling: at === 0 ? ("narration" as const) : ("calm" as const),
      strength: 2 as const,
    }));
    const felt = await speech.of(tree.get(hello.id), "pt-BR-FranciscaNeural", lines);
    const ssml = read.find((what) => what.startsWith("<speak"))!;
    expect(ssml).toContain('<prosody rate="-6%" pitch="-3%" volume="-10%">Waves.</prosody>');
    expect(ssml).toContain('<mstts:express-as style="calm" styledegree="1.2">Hello.</mstts:express-as>');
    expect(felt.read).toBe("Waves.Hello.".length);

    // The same way of saying it is kept; another is read again; plainly is another reading too.
    expect((await speech.of(tree.get(hello.id), "pt-BR-FranciscaNeural", lines)).read).toBe(0);
    const sadder = lines.map((line) => ({ ...line, feeling: "sad" as const }));
    expect((await speech.of(tree.get(hello.id), "pt-BR-FranciscaNeural", sadder)).file).not.toBe(felt.file);
    expect((await speech.of(tree.get(hello.id), "pt-BR-FranciscaNeural")).read).toBeGreaterThan(0);
  });

  it("asks Azure for its voices once, not every time", async () => {
    const { read, speech } = setup();
    expect(await speech.voices()).toEqual([VOICE]);
    expect(await speech.voices()).toEqual([VOICE]);
    expect(read.filter((what) => what === "voices")).toHaveLength(1);
  });

  it("reads a sample to try a voice, counts it, and keeps it for asking again", async () => {
    const { db, dir, read, speech } = setup();
    expect(await speech.sample("pt-BR-FranciscaNeural", "*Smiles.* Olá!")).toEqual({ audio: MP3, type: "audio/mpeg" });
    expect(read[0]).toContain('<voice name="pt-BR-FranciscaNeural">Smiles. Olá!</voice>');
    expect(charsThisMonth(db, "azure")).toBe("Smiles. Olá!".length);
    await speech.sample("pt-BR-FranciscaNeural", "*Smiles.* Olá!");
    expect(read).toHaveLength(1);
    expect(charsThisMonth(db, "azure")).toBe("Smiles. Olá!".length);
    // Nothing is kept on disk.
    expect(readdirSync(dir)).toEqual([]);
    await expect(speech.sample("pt-BR-FranciscaNeural", " * ")).rejects.toThrow(/Write something/);
  });

  it("reads a sample with a feeling, as another sample", async () => {
    const { read, speech } = setup();
    await speech.sample("pt-BR-FranciscaNeural", "Olá!");
    await speech.sample("pt-BR-FranciscaNeural", "Olá!", "whispering");
    const ssml = read.filter((what) => what.startsWith("<speak"));
    expect(ssml).toHaveLength(2);
    expect(ssml[1]).toContain('<prosody rate="-8%" pitch="-4%" volume="-40%">Olá!</prosody>');
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
      engines: { azure: azureVoice({ synthesize: () => Promise.reject(new Error("down")), voices: async () => [] }) },
      files,
      voice: "v",
    });
    await expect(failing.of(tree.get(hello.id))).rejects.toThrow("down");
    expect(readdirSync(dir)).toEqual([]);
    expect(charsThisMonth(db, "azure")).toBe(0);
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

describe("reading aloud at a companion's speed, pitch and style", () => {
  it("keeps the audio read before when nothing is changed", async () => {
    const { tree, hello, speech } = setup();
    const before = await speech.of(tree.get(hello.id));
    const same = await speech.of(tree.get(hello.id), undefined, null, { rate: 0, pitch: 0, style: null });
    expect(same).toEqual({ file: before.file, engine: "azure", read: 0 });
  });

  it("reads again at another speed, pitch or style", async () => {
    const { tree, hello, read, speech } = setup();
    const before = await speech.of(tree.get(hello.id), "pt-BR-FranciscaNeural");
    const faster = await speech.of(tree.get(hello.id), "pt-BR-FranciscaNeural", null, {
      rate: 10,
      pitch: 0,
      style: null,
    });
    expect(faster.file).not.toBe(before.file);
    expect(read.at(-1)).toContain('<prosody rate="+10%">Waves. Hello.</prosody>');
    await speech.of(tree.get(hello.id), "pt-BR-FranciscaNeural", null, { rate: 10, pitch: 0, style: "calm" });
    expect(read.at(-1)).toContain('<mstts:express-as style="calm"><prosody rate="+10%">');
  });

  it("leaves out a style the voice hasn't", async () => {
    const { tree, hello, read, speech } = setup();
    await speech.of(tree.get(hello.id), "pt-BR-FranciscaNeural", null, { rate: 0, pitch: 0, style: "cheerful" });
    expect(read.at(-1)).toContain('<voice name="pt-BR-FranciscaNeural">Waves. Hello.</voice>');
  });

  it("reads a sample at the speed asked for, as another sample", async () => {
    const { read, speech } = setup();
    await speech.sample("pt-BR-FranciscaNeural", "Olá!");
    await speech.sample("pt-BR-FranciscaNeural", "Olá!", null, { rate: -20, pitch: 5, style: null });
    const ssml = read.filter((what) => what.startsWith("<speak"));
    expect(ssml).toHaveLength(2);
    expect(ssml[1]).toContain('<prosody rate="-20%" pitch="+5%">Olá!</prosody>');
  });
});

/** A server with both engines: Azure as in setup(), and a fake Grok that keeps what it was asked. */
function withGrok() {
  const base = setup();
  const asked: GrokReading[] = [];
  const grok: GrokSpeech = {
    synthesize: async (reading: GrokReading) => {
      asked.push(reading);
      return MP3;
    },
    voices: async () => [
      { ...VOICE, id: "grok:eve", engine: "grok", name: "Eve", styles: [], language: "Grok, any language" },
    ],
  };
  const azure = azureVoice({ synthesize: async () => MP3, voices: async () => [VOICE] });
  const speech = createSpeech({
    db: base.db,
    engines: { azure, grok: grokVoice(grok) },
    files: base.files,
    voice: "en-US-AvaMultilingualNeural",
  });
  return { ...base, asked, speech };
}

describe("reading aloud in Grok's voices", () => {
  it("reads a grok: voice with Grok, apart from Azure, and counts it as Grok's", async () => {
    const { db, tree, hello, asked, speech } = withGrok();
    const azure = await speech.of(tree.get(hello.id));
    const grok = await speech.of(tree.get(hello.id), "grok:eve");
    expect(grok.engine).toBe("grok");
    expect(grok.file).not.toBe(azure.file);
    expect(asked).toEqual([{ text: "Waves. Hello.", voiceId: "eve", speed: 1 }]);
    expect(db.prepare("SELECT engine FROM speech WHERE file = ?").get(grok.file)).toEqual({ engine: "grok" });
    expect(charsThisMonth(db, "grok")).toBe("Waves. Hello.".length);
    expect(charsThisMonth(db, "azure")).toBe("Waves. Hello.".length);
  });

  it("lists Grok's voices first, then Azure's", async () => {
    const { speech } = withGrok();
    expect((await speech.voices()).map((voice) => voice.id)).toEqual(["grok:eve", "pt-BR-FranciscaNeural"]);
  });

  it("still lists one engine's voices when the other can't be reached", async () => {
    const { db, files } = setup();
    const speech = createSpeech({
      db,
      engines: {
        azure: azureVoice({ synthesize: async () => MP3, voices: () => Promise.reject(new Error("down")) }),
        grok: grokVoice({ synthesize: async () => MP3, voices: async () => [] }),
      },
      files,
      voice: "v",
    });
    expect(await speech.voices()).toEqual([]);
  });

  it("refuses a voice whose engine has no key", async () => {
    const { tree, hello, speech } = setup();
    await expect(speech.of(tree.get(hello.id), "grok:eve")).rejects.toThrow(/no xAI key/);
    await expect(speech.sample("grok:eve", "Hi")).rejects.toThrow(/no xAI key/);
  });

  it("reads each line with Grok's tags and its sound", async () => {
    const { tree, hello, asked, speech } = withGrok();
    const lines = linesOf("*Waves.* Hello.").map((line, at) => ({
      ...line,
      feeling: at === 0 ? ("narration" as const) : ("whispering" as const),
      strength: 2 as const,
      sound: at === 1 ? ("sigh" as const) : null,
    }));
    await speech.of(tree.get(hello.id), "grok:eve", lines);
    expect(asked[0]!.text).toBe("<soft>Waves.</soft> <whisper>[sigh] Hello.</whisper>");
  });

  it("reads at the companion's speed, within Grok's, and doesn't read again for pitch it ignores", async () => {
    const { tree, hello, asked, speech } = withGrok();
    const fast = await speech.of(tree.get(hello.id), "grok:eve", null, { rate: 80, pitch: 0, style: null });
    expect(asked[0]!.speed).toBe(1.5);
    const higher = await speech.of(tree.get(hello.id), "grok:eve", null, { rate: 80, pitch: 20, style: null });
    expect(higher).toEqual({ file: fast.file, engine: "grok", read: 0 });
    expect(asked).toHaveLength(1);
  });

  it("keeps the audio read before sounds existed, and reads a sound again", async () => {
    const { tree, hello, speech } = withGrok();
    const lines = linesOf("Hello.").map((line) => ({ ...line, feeling: "warm" as const, strength: 2 as const }));
    tree.edit(hello.id, "Hello.");
    const before = await speech.of(tree.get(hello.id), "grok:eve", lines);
    const none = lines.map((line) => ({ ...line, sound: null }));
    expect((await speech.of(tree.get(hello.id), "grok:eve", none)).read).toBe(0);
    const sighed = lines.map((line) => ({ ...line, sound: "sigh" as const }));
    expect((await speech.of(tree.get(hello.id), "grok:eve", sighed)).file).not.toBe(before.file);
  });

  it("serves a Grok sample as MP3", async () => {
    const { speech } = withGrok();
    expect(await speech.sample("grok:eve", "Olá!")).toEqual({ audio: MP3, type: "audio/mpeg" });
  });
});
