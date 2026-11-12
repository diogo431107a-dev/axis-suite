import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendLine, appendLines, listFolders, listIds, readJson, readLines, remove, writeJson } from "./files.ts";
import { StoreError } from "./errors.ts";

const windows = vi.hoisted(() => ({ refusals: 0 }));

// Windows refusing a rename for a moment, which is what a virus scanner or the search indexer
// looks like from here. Everything else about the file system stays real.
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    rename: async (from: string, to: string) => {
      if (windows.refusals > 0) {
        windows.refusals -= 1;
        throw Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" });
      }
      return real.rename(from, to);
    },
  };
});

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "valhalla-"));
  windows.refusals = 0;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("writing a JSON file", () => {
  it("creates the folders it needs and reads back what was written", async () => {
    const file = join(dir, "characters", "deep", "one.json");
    await writeJson(file, { name: "Gudrun" });
    expect(await readJson(file)).toEqual({ name: "Gudrun" });
  });

  it("leaves no temporary file behind", async () => {
    await writeJson(join(dir, "one.json"), { name: "Gudrun" });
    expect(await readdir(dir)).toEqual(["one.json"]);
  });

  it("replaces the previous contents", async () => {
    const file = join(dir, "one.json");
    await writeJson(file, { name: "Gudrun" });
    await writeJson(file, { name: "Hrafn" });
    expect(await readJson(file)).toEqual({ name: "Hrafn" });
  });

  it("answers null for a file that isn't there", async () => {
    expect(await readJson(join(dir, "missing.json"))).toBeNull();
  });

  it("refuses a file that is not valid JSON, instead of guessing", async () => {
    const file = join(dir, "broken.json");
    await writeFile(file, "{ this is not json", "utf8");
    await expect(readJson(file)).rejects.toBeInstanceOf(StoreError);
  });

  it("runs writes to one file one at a time, so the last one wins", async () => {
    const file = join(dir, "one.json");
    await Promise.all([1, 2, 3, 4, 5].map((n) => writeJson(file, { n })));
    expect(await readJson(file)).toEqual({ n: 5 });
  });

  it("keeps writing to a file after a failed write to another one", async () => {
    // A folder where a file should be: the write fails, and the queue must not jam.
    const asFolder = join(dir, "folder.json");
    await writeJson(join(asFolder, "inside.json"), { ok: true });
    await expect(writeJson(asFolder, { no: true })).rejects.toBeTruthy();
    await writeJson(join(dir, "after.json"), { ok: true });
    expect(await readJson(join(dir, "after.json"))).toEqual({ ok: true });
  });

  it("waits out a file Windows has locked for a moment, instead of failing the write", async () => {
    const file = join(dir, "one.json");
    windows.refusals = 3;
    await writeJson(file, { name: "Gudrun" });
    expect(await readJson(file)).toEqual({ name: "Gudrun" });
    expect(windows.refusals).toBe(0);
  });

  it("gives up on a lock that stays, leaving the old file and no temporary one", async () => {
    const file = join(dir, "one.json");
    await writeJson(file, { name: "Gudrun" });
    windows.refusals = Number.MAX_SAFE_INTEGER;
    await expect(writeJson(file, { name: "Hrafn" })).rejects.toThrow(/Another program is holding/);
    expect(await readJson(file)).toEqual({ name: "Gudrun" });
    expect(await readdir(dir)).toEqual(["one.json"]);
  });
});

describe("a conversation log", () => {
  it("is empty before anything is written", async () => {
    expect(await readLines(join(dir, "turns.jsonl"))).toEqual([]);
  });

  it("keeps the turns in the order they were added", async () => {
    const file = join(dir, "turns.jsonl");
    await appendLine(file, { n: 1 });
    await appendLine(file, { n: 2 });
    await appendLine(file, { n: 3 });
    expect(await readLines(file)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it("writes one line per turn even when several are added at once", async () => {
    const file = join(dir, "turns.jsonl");
    await Promise.all([1, 2, 3, 4, 5].map((n) => appendLine(file, { n })));
    const lines = (await readFile(file, "utf8")).trimEnd().split("\n");
    expect(lines).toHaveLength(5);
    expect(await readLines(file)).toHaveLength(5);
  });

  it("drops a last line that a crash cut short, and says so", async () => {
    const file = join(dir, "turns.jsonl");
    await appendLine(file, { n: 1 });
    await appendLine(file, { n: 2 });
    // A write that never finished: no newline at the end.
    await writeFile(file, `${await readFile(file, "utf8")}{"n":3,"content":[{"ty`, "utf8");
    const said = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await readLines(file)).toEqual([{ n: 1 }, { n: 2 }]);
    expect(said).toHaveBeenCalledOnce();
    said.mockRestore();
  });

  it("writes several turns as one line each, in the order they were given", async () => {
    const file = join(dir, "turns.jsonl");
    await appendLines(file, [{ n: 1 }, { n: 2 }]);
    await appendLines(file, [{ n: 3 }]);
    expect(await readLines(file)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it("writes nothing at all for no turns", async () => {
    const file = join(dir, "turns.jsonl");
    await appendLines(file, []);
    expect(await readLines(file)).toEqual([]);
  });

  it("refuses a broken line in the middle rather than skipping it", async () => {
    const file = join(dir, "turns.jsonl");
    await writeFile(file, '{"n":1}\nnot json\n{"n":3}\n', "utf8");
    await expect(readLines(file)).rejects.toBeInstanceOf(StoreError);
  });
});

describe("looking around the data folder", () => {
  it("lists the ids of the JSON files, ignoring anything else", async () => {
    await writeJson(join(dir, "a.json"), {});
    await writeJson(join(dir, "b.json"), {});
    await writeFile(join(dir, "notes.txt"), "hello", "utf8");
    expect((await listIds(dir)).sort()).toEqual(["a", "b"]);
  });

  it("lists the conversation folders", async () => {
    await writeJson(join(dir, "one", "conversation.json"), {});
    await writeJson(join(dir, "two", "conversation.json"), {});
    await writeFile(join(dir, "loose.json"), "{}", "utf8");
    expect((await listFolders(dir)).sort()).toEqual(["one", "two"]);
  });

  it("answers nothing for a folder that doesn't exist", async () => {
    expect(await listIds(join(dir, "nowhere"))).toEqual([]);
    expect(await listFolders(join(dir, "nowhere"))).toEqual([]);
  });

  it("deletes a folder and everything in it, and doesn't mind doing it twice", async () => {
    const folder = join(dir, "gone");
    await writeJson(join(folder, "conversation.json"), {});
    await appendLine(join(folder, "turns.jsonl"), { n: 1 });
    await remove(folder);
    await remove(folder);
    expect(await listFolders(dir)).toEqual([]);
  });
});
