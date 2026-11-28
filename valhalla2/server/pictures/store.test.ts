import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS, type GrokPictureParams, type PictureParams } from "../../shared/protocol.ts";
import { createChats } from "../chat/chats.ts";
import { CivitaiError, civitaiEngine, jobFor, type Civitai } from "./civitai.ts";
import { createCompanions } from "../companions.ts";
import { openDatabase } from "../db.ts";
import { createFileStore } from "../files.ts";
import type { PictureEngine } from "./engine.ts";
import { grokImagineEngine, type GrokImagine } from "./grok.ts";
import { createPainter } from "./painter.ts";
import { createPictures, knownFiles, setWorkflow, type NewPicture } from "./store.ts";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const params: PictureParams = { model: "m", width: 832, height: 1216, steps: 30, cfgScale: 7, seed: 1 };

function setup() {
  const db = openDatabase(":memory:");
  const companions = createCompanions(db, "odin", DEFAULT_SETTINGS);
  companions.save("comp-0001", { name: "Freya", profile: "<appearance>Gold hair.</appearance>" });
  const chats = createChats(db, "odin", companions, 5);
  chats.create({ id: "chat-0001", companionId: "comp-0001" });
  const tree = chats.tree("chat-0001");
  const hello = tree.add({ parentId: null, role: "assistant", content: [{ type: "text", text: "Hello." }] });
  tree.setLeaf(hello.id);
  const dir = mkdtempSync(join(tmpdir(), "valhalla2-pictures-"));
  made.push(dir);
  const files = createFileStore(dir);
  return { db, companions, chats, tree, hello, files, dir, pictures: createPictures(db, "odin") };
}

const newPicture = (id: string, fields: Partial<NewPicture> = {}): NewPicture => ({
  id,
  companionId: "comp-0001",
  kind: "profile",
  chatId: null,
  messageId: null,
  prompt: "1girl, gold hair",
  negativePrompt: "bad quality",
  orientation: "portrait",
  caption: "Freya",
  params,
  engine: "civitai",
  ...fields,
});

const grokParams: GrokPictureParams = {
  engine: "grok",
  model: "grok-imagine-image-2.0",
  aspectRatio: "2:3",
  resolution: "1k",
  quality: "auto",
};

/** A Grok Imagine that makes every picture within the request, at 4 cents, and says what it was asked. */
function grokImagine(): GrokImagine & { asked: unknown[] } {
  const fake = {
    asked: [] as unknown[],
    generate: (image: unknown) => {
      fake.asked.push(image);
      return Promise.resolve({ bytes: PNG, type: "image/png", ext: "png", cost: 0.04 });
    },
  };
  return fake;
}

/** A CivitAI that makes every picture at once, or fails with `error`. */
function civitai(error?: string): Civitai & { submitted: number } {
  const fake = {
    submitted: 0,
    submit: () => {
      fake.submitted++;
      return error ? Promise.reject(new CivitaiError(error)) : Promise.resolve({ id: "wf-1", status: "succeeded" });
    },
    estimate: () => Promise.resolve(3),
    finish: () => Promise.resolve("https://img"),
    download: () => Promise.resolve({ bytes: PNG, type: "image/png", ext: "png" }),
  };
  return fake;
}

describe("pictures", () => {
  it("are their owner's alone", () => {
    const { db, pictures } = setup();
    pictures.create(newPicture("pic-00001"));
    expect(pictures.get("pic-00001").status).toBe("working");
    const other = createPictures(db, "loki");
    expect(() => other.get("pic-00001")).toThrow(/No such picture/);
    expect(other.of("comp-0001")).toEqual([]);
  });

  it("are made in the background, saved as a file, and marked done", async () => {
    const { db, pictures, files, dir } = setup();
    pictures.create(newPicture("pic-00001"));
    await createPainter({ db, engines: { civitai: civitaiEngine(civitai()) }, files }).paint("pic-00001", null);
    expect(pictures.get("pic-00001").status).toBe("done");
    expect(pictures.fileOf("pic-00001")).toBe("pic-00001.png");
    expect(readdirSync(dir)).toEqual(["pic-00001.png"]);
  });

  it("say why when they weren't made", async () => {
    const { db, pictures, files } = setup();
    pictures.create(newPicture("pic-00001"));
    await createPainter({ db, engines: { civitai: civitaiEngine(civitai("No Buzz left")) }, files }).paint(
      "pic-00001",
      null,
    );
    expect(pictures.get("pic-00001")).toMatchObject({ status: "failed", error: "No Buzz left" });
    expect(pictures.fileOf("pic-00001")).toBeNull();
  });

  it("deleted while being made leave no file behind", async () => {
    const { db, pictures, files, dir } = setup();
    pictures.create(newPicture("pic-00001"));
    setWorkflow(db, "pic-00001", "wf-1", "civitai");
    const painting = createPainter({ db, engines: { civitai: civitaiEngine(civitai()) }, files }).paint(
      "pic-00001",
      "wf-1",
    );
    pictures.remove("pic-00001");
    await painting;
    expect(readdirSync(dir)).toEqual([]);
  });

  it("cut short by a stop are picked up again, or failed when never asked for", async () => {
    const { db, pictures, files } = setup();
    pictures.create(newPicture("pic-00001"));
    pictures.create(newPicture("pic-00002"));
    setWorkflow(db, "pic-00001", "wf-1", "civitai");
    const fake = civitai();
    expect(createPainter({ db, engines: { civitai: civitaiEngine(fake) }, files }).resume()).toBe(2);
    await new Promise((done) => setTimeout(done, 10));
    expect(fake.submitted).toBe(0);
    expect(pictures.get("pic-00001").status).toBe("done");
    expect(pictures.get("pic-00002").status).toBe("failed");
  });

  it("asked of another engine aren't looked for here after a stop", async () => {
    const { db, pictures, files } = setup();
    pictures.create(newPicture("pic-00001"));
    setWorkflow(db, "pic-00001", "job-1", "another");
    const fake = civitai();
    createPainter({ db, engines: { civitai: civitaiEngine(fake) }, files }).resume();
    await new Promise((done) => setTimeout(done, 10));
    expect(pictures.get("pic-00001")).toMatchObject({ status: "failed", error: expect.stringMatching(/another/) });
  });

  it("go to CivitAI with their sampler and clip skip, or the defaults for an older one", () => {
    expect(jobFor({ prompt: "p", negativePrompt: "n", params })).toMatchObject({
      sampleMethod: "euler_a",
      clipSkip: 2,
      seed: 1,
    });
    const chosen = jobFor({ prompt: "p", negativePrompt: "n", params: { ...params, sampler: "dpm++2m", clipSkip: 1 } });
    expect(chosen).toMatchObject({ sampleMethod: "dpm++2m", clipSkip: 1 });
    expect(chosen).not.toHaveProperty("sampler");
  });

  it("made by Grok Imagine are kept straight from its answer, with their cost", async () => {
    const { db, pictures, files, dir } = setup();
    pictures.create(newPicture("pic-00001", { engine: "grok", params: grokParams, negativePrompt: "" }));
    const fake = grokImagine();
    const engines: Partial<Record<"civitai" | "grok", PictureEngine>> = {
      civitai: civitaiEngine(civitai()),
      grok: grokImagineEngine(fake),
    };
    await createPainter({ db, engines, files }).paint("pic-00001", null);
    expect(fake.asked).toEqual([
      {
        model: "grok-imagine-image-2.0",
        prompt: "1girl, gold hair",
        aspectRatio: "2:3",
        resolution: "1k",
        quality: "auto",
      },
    ]);
    expect(pictures.get("pic-00001")).toMatchObject({ status: "done", engine: "grok", cost: 0.04, params: grokParams });
    expect(readdirSync(dir)).toEqual(["pic-00001.png"]);
  });

  it("made by CivitAI have no cost, and older ones read as CivitAI's", async () => {
    const { db, pictures, files } = setup();
    pictures.create(newPicture("pic-00001"));
    await createPainter({ db, engines: { civitai: civitaiEngine(civitai()) }, files }).paint("pic-00001", null);
    expect(pictures.get("pic-00001")).toMatchObject({ status: "done", engine: "civitai", cost: null });
    expect(pictures.get("pic-00001").params).not.toHaveProperty("engine");
  });

  it("whose engine the server has no key for any more fail and say so", async () => {
    const { db, pictures, files } = setup();
    pictures.create(newPicture("pic-00001", { engine: "grok", params: grokParams }));
    await createPainter({ db, engines: { civitai: civitaiEngine(civitai()) }, files }).paint("pic-00001", null);
    expect(pictures.get("pic-00001")).toMatchObject({ status: "failed", error: expect.stringMatching(/Grok Imagine/) });
  });

  it("Grok Imagine was making when the server stopped fail, since there is nothing to pick up", () => {
    const { db, pictures, files } = setup();
    pictures.create(newPicture("pic-00001", { engine: "grok", params: grokParams }));
    const fake = grokImagine();
    createPainter({ db, engines: { grok: grokImagineEngine(fake) }, files }).resume();
    expect(fake.asked).toEqual([]);
    expect(pictures.get("pic-00001")).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/while Grok Imagine was making/),
    });
  });

  it("OpenAI was making when the server stopped fail the same way", () => {
    const { db, pictures, files } = setup();
    const params = {
      engine: "openai" as const,
      model: "gpt-image-2.6-flare",
      size: "1024x1536",
      quality: "medium" as const,
    };
    pictures.create(newPicture("pic-00001", { engine: "openai", params }));
    createPainter({ db, engines: { grok: grokImagineEngine(grokImagine()) }, files }).resume();
    expect(pictures.get("pic-00001")).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/while OpenAI was making/),
    });
  });

  it("go to each engine only with its own parameters", async () => {
    expect(() => jobFor({ prompt: "p", negativePrompt: "", params: grokParams })).toThrow(/not CivitAI/);
    await expect(grokImagineEngine(grokImagine()).submit({ prompt: "p", negativePrompt: "", params })).rejects.toThrow(
      /not Grok Imagine/,
    );
  });

  it("can't pile up: only a few are made at once", () => {
    const { pictures } = setup();
    pictures.create(newPicture("pic-00001"));
    pictures.create(newPicture("pic-00002"));
    pictures.create(newPicture("pic-00003"));
    expect(() => pictures.create(newPicture("pic-00004"))).toThrow(/already being made/);
  });

  it("of a chat show on the page under their message, and stay when the chat goes", () => {
    const { chats, pictures, hello } = setup();
    pictures.create(newPicture("pic-00001", { kind: "chat", chatId: "chat-0001", messageId: hello.id }));
    expect(chats.page("chat-0001").pictures.map((picture) => picture.id)).toEqual(["pic-00001"]);
    expect(pictures.get("pic-00001").chatTitle).toBe("Freya");
    chats.remove("chat-0001");
    expect(pictures.get("pic-00001")).toMatchObject({ chatId: null, messageId: null, chatTitle: null });
  });

  it("go with their companion, and the sweep takes the files nothing names", () => {
    const { db, companions, pictures, files, dir } = setup();
    pictures.create(newPicture("pic-00001"));
    files.write("pic-00001", "png", PNG);
    db.prepare("UPDATE pictures SET status = 'done', file = 'pic-00001.png'").run();
    writeFileSync(join(dir, "stray.png.tmp"), "half");
    expect(files.sweep(knownFiles(db))).toBe(1);
    expect(pictures.filesOf("comp-0001")).toEqual(["pic-00001.png"]);
    companions.remove("comp-0001");
    expect(files.sweep(knownFiles(db))).toBe(1);
    expect(existsSync(join(dir, "pic-00001.png"))).toBe(false);
  });
});
