import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { ToolError } from "@anthropic-ai/sdk/lib/tools/ToolError";
import type { ChatMode } from "../../shared/protocol.ts";
import { openDatabase } from "../db.ts";
import { withMemoryLock } from "./lock.ts";
import { PathError, relativePath } from "./paths.ts";
import { createMemory, lineDiff, MemoryError, SEED_FILES } from "./store.ts";
import { memoryCommands } from "./tool.ts";

const LIMITS = { fileBytes: 200, storyBytes: 400, files: 10, viewChars: 16_000 };
type Command = Anthropic.Beta.BetaMemoryTool20250818Command;

function setup(mode: ChatMode = "canon") {
  const db = openDatabase(":memory:");
  const memory = createMemory(db, LIMITS);
  const commands = memoryCommands({
    db,
    memory,
    limits: LIMITS,
    space: "comp",
    source: "consolidate:chat-1",
    runId: 7,
    chatId: "chat-1",
    mode,
  });
  /** What the model is told: the result, or the error text it gets with is_error. */
  const run = (command: Command): { ok: boolean; text: string } => {
    try {
      const handler = commands[command.command] as (c: Command) => string;
      return { ok: true, text: handler(command) };
    } catch (err) {
      if (err instanceof ToolError) return { ok: false, text: String(err.content) };
      throw err;
    }
  };
  const versions = () => (db.prepare("SELECT count(*) AS n FROM memory_versions").get() as { n: number }).n;
  return { db, memory, run, versions };
}

describe("paths", () => {
  it("are relative to /memories", () => {
    expect(relativePath("/memories")).toBe("");
    expect(relativePath("/memories/")).toBe("");
    expect(relativePath("/memories/story/recent.md")).toBe("story/recent.md");
  });

  it.each([
    "/memories/../secrets.env",
    "/memories/story/../../etc/passwd",
    "/memories/..\\secrets",
    "/memories/%2e%2e%2fsecrets",
    "/memories/%252e%252e%252fsecrets",
    "/etc/passwd",
    "/memoriesX/file.md",
    "memories/file.md",
    "/memories//file.md",
    "/memories/./file.md",
    "",
  ])("refuse %j", (path) => {
    expect(() => relativePath(path)).toThrow(PathError);
  });
});

describe("view", () => {
  it("lists a directory two levels deep with readable sizes", () => {
    const { memory, run } = setup();
    memory.write("comp", "user.md", "abc", { op: "create", source: "t" });
    memory.write("comp", "story/recent.md", "x".repeat(148), { op: "create", source: "t" });
    memory.write("comp", "a/b/c/deep.md", "d", { op: "create", source: "t" });
    const { ok, text } = run({ command: "view", path: "/memories" });
    expect(ok).toBe(true);
    expect(text.split("\n")).toEqual([
      "Here're the files and directories up to 2 levels deep in /memories, excluding hidden items and node_modules:",
      "152B\t/memories",
      "1B\t/memories/a",
      "1B\t/memories/a/b",
      "148B\t/memories/story",
      "148B\t/memories/story/recent.md",
      "3B\t/memories/user.md",
    ]);
  });

  it("shows a file with line numbers, and a range of it", () => {
    const { memory, run } = setup();
    memory.write("comp", "user.md", "one\ntwo\nthree\n", { op: "create", source: "t" });
    expect(run({ command: "view", path: "/memories/user.md" }).text).toBe(
      "Here's the content of /memories/user.md with line numbers:\n     1\tone\n     2\ttwo\n     3\tthree",
    );
    expect(run({ command: "view", path: "/memories/user.md", view_range: [2, -1] }).text).toBe(
      "Here's the content of /memories/user.md with line numbers:\n     2\ttwo\n     3\tthree",
    );
    expect(run({ command: "view", path: "/memories/user.md", view_range: [3, 9] }).ok).toBe(false);
  });

  it("cuts a long view and says how to read the rest", () => {
    const db = openDatabase(":memory:");
    const memory = createMemory(db, { ...LIMITS, fileBytes: 100_000, viewChars: 100 });
    memory.write("comp", "long.md", Array.from({ length: 50 }, (_, n) => `line ${n + 1}`).join("\n"), {
      op: "create",
      source: "t",
    });
    const commands = memoryCommands({
      db,
      memory,
      limits: { ...LIMITS, viewChars: 100 },
      space: "comp",
      source: "t",
      runId: null,
      chatId: null,
      mode: "canon",
    });
    const text = (commands.view as (c: Command) => string)({ command: "view", path: "/memories/long.md" });
    expect(text).toMatch(/\[Shown up to line \d+ of 50\. View the rest with view_range: \[\d+, -1\]\.\]$/);
  });

  it("says when a path does not exist", () => {
    expect(setup().run({ command: "view", path: "/memories/nope.md" })).toEqual({
      ok: false,
      text: "The path /memories/nope.md does not exist. Please provide a valid path.",
    });
  });

  it("lists an empty memory without an error", () => {
    expect(setup().run({ command: "view", path: "/memories" })).toEqual({
      ok: true,
      text: "Here're the files and directories up to 2 levels deep in /memories, excluding hidden items and node_modules:\n0B\t/memories",
    });
  });
});

describe("changing files", () => {
  it("creates, and replaces on a second create", () => {
    const { memory, run } = setup();
    expect(run({ command: "create", path: "/memories/user.md", file_text: "Name: Eadric\n" })).toEqual({
      ok: true,
      text: "File created successfully at: /memories/user.md",
    });
    run({ command: "create", path: "/memories/user.md", file_text: "Name: Wulf\n" });
    expect(memory.read("comp", "user.md")?.content).toBe("Name: Wulf\n");
  });

  it("replaces text that appears once, and shows the lines around it", () => {
    const { memory, run } = setup();
    memory.write("comp", "user.md", "Name: Eadric\nAge: 20\n", { op: "create", source: "t" });
    const result = run({ command: "str_replace", path: "/memories/user.md", old_str: "Age: 20", new_str: "Age: 21" });
    expect(result.ok).toBe(true);
    expect(result.text).toBe("The memory file has been edited.\n     1\tName: Eadric\n     2\tAge: 21");
    expect(memory.read("comp", "user.md")?.content).toBe("Name: Eadric\nAge: 21\n");
  });

  it("refuses a replacement that isn't there, or isn't unique", () => {
    const { memory, run } = setup();
    memory.write("comp", "user.md", "cat\ndog\ncat\n", { op: "create", source: "t" });
    expect(run({ command: "str_replace", path: "/memories/user.md", old_str: "bird", new_str: "x" }).text).toBe(
      "No replacement was performed, old_str `bird` did not appear verbatim in /memories/user.md.",
    );
    expect(run({ command: "str_replace", path: "/memories/user.md", old_str: "cat", new_str: "x" }).text).toBe(
      "No replacement was performed. Multiple occurrences of old_str `cat` in lines: 1, 3. Please ensure it is unique",
    );
    expect(run({ command: "str_replace", path: "/memories/none.md", old_str: "a", new_str: "b" }).text).toBe(
      "Error: The path /memories/none.md does not exist. Please provide a valid path.",
    );
  });

  it("inserts after a line, and refuses a line that isn't there", () => {
    const { memory, run } = setup();
    memory.write("comp", "todo.md", "a\nc", { op: "create", source: "t" });
    expect(run({ command: "insert", path: "/memories/todo.md", insert_line: 1, insert_text: "b\n" }).text).toBe(
      "The file /memories/todo.md has been edited.",
    );
    expect(memory.read("comp", "todo.md")?.content).toBe("a\nb\nc");
    expect(run({ command: "insert", path: "/memories/todo.md", insert_line: 9, insert_text: "x" }).text).toBe(
      "Error: Invalid `insert_line` parameter: 9. It should be within the range of lines of the file: [0, 3]",
    );
    expect(run({ command: "insert", path: "/memories/gone.md", insert_line: 0, insert_text: "x" }).text).toBe(
      "Error: The path /memories/gone.md does not exist",
    );
  });

  it("deletes a file, or a directory with everything in it, but never /memories", () => {
    const { memory, run } = setup();
    memory.write("comp", "story/recent.md", "r", { op: "create", source: "t" });
    memory.write("comp", "story/arcs.md", "a", { op: "create", source: "t" });
    memory.write("comp", "user.md", "u", { op: "create", source: "t" });
    expect(run({ command: "delete", path: "/memories/story" }).text).toBe("Successfully deleted /memories/story");
    expect(memory.files("comp").map((file) => file.path)).toEqual(["user.md"]);
    expect(run({ command: "delete", path: "/memories/story" }).text).toBe(
      "Error: The path /memories/story does not exist",
    );
    expect(run({ command: "delete", path: "/memories" }).ok).toBe(false);
  });

  it("renames a file or a directory, never onto something that exists", () => {
    const { memory, run } = setup();
    memory.write("comp", "story/recent.md", "r", { op: "create", source: "t" });
    memory.write("comp", "user.md", "u", { op: "create", source: "t" });
    expect(run({ command: "rename", old_path: "/memories/story", new_path: "/memories/tale" }).text).toBe(
      "Successfully renamed /memories/story to /memories/tale",
    );
    expect(memory.read("comp", "tale/recent.md")?.content).toBe("r");
    expect(run({ command: "rename", old_path: "/memories/user.md", new_path: "/memories/tale/recent.md" }).text).toBe(
      "Error: The destination /memories/tale/recent.md already exists",
    );
    expect(run({ command: "rename", old_path: "/memories/nope", new_path: "/memories/x" }).text).toBe(
      "Error: The path /memories/nope does not exist",
    );
    expect(run({ command: "rename", old_path: "/memories", new_path: "/memories/x" }).ok).toBe(false);
  });

  it("refuses paths outside /memories in every command", () => {
    const { run } = setup();
    expect(run({ command: "create", path: "/memories/../x.md", file_text: "x" }).ok).toBe(false);
    expect(run({ command: "rename", old_path: "/memories/a.md", new_path: "/tmp/a.md" }).ok).toBe(false);
  });
});

describe("limits", () => {
  it("refuses a file over its size, saying to condense it first", () => {
    const { run, versions } = setup();
    const result = run({ command: "create", path: "/memories/user.md", file_text: "x".repeat(201) });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("over its limit of 200B. Condense it first");
    expect(versions()).toBe(0);
  });

  it("gives the story files more room", () => {
    const { run } = setup();
    expect(run({ command: "create", path: "/memories/story/recent.md", file_text: "x".repeat(300) }).ok).toBe(true);
  });

  it("refuses one file too many", () => {
    const { run } = setup();
    for (let n = 0; n < 10; n++) run({ command: "create", path: `/memories/f${n}.md`, file_text: "x" });
    expect(run({ command: "create", path: "/memories/f10.md", file_text: "x" }).text).toContain("holds 10 files");
  });
});

describe("a one-shot chat", () => {
  it("may not write world.md or story/, and may write the rest", () => {
    const { memory, run } = setup("one-shot");
    memory.write("comp", "world.md", "w", { op: "create", source: "t" });
    memory.write("comp", "story/recent.md", "r", { op: "create", source: "t" });
    expect(run({ command: "create", path: "/memories/world.md", file_text: "x" }).text).toContain(
      "read-only for this chat",
    );
    expect(run({ command: "str_replace", path: "/memories/story/recent.md", old_str: "r", new_str: "s" }).ok).toBe(
      false,
    );
    expect(run({ command: "delete", path: "/memories/story" }).ok).toBe(false);
    expect(run({ command: "rename", old_path: "/memories/world.md", new_path: "/memories/w.md" }).ok).toBe(false);
    expect(run({ command: "view", path: "/memories/world.md" }).ok).toBe(true);
    expect(run({ command: "create", path: "/memories/user.md", file_text: "Likes rain." }).ok).toBe(true);
  });
});

describe("every change", () => {
  it("writes exactly one version, and a refused one writes none", () => {
    const { memory, run, versions } = setup();
    run({ command: "create", path: "/memories/user.md", file_text: "a" });
    run({ command: "str_replace", path: "/memories/user.md", old_str: "a", new_str: "b" });
    run({ command: "insert", path: "/memories/user.md", insert_line: 1, insert_text: "c" });
    expect(versions()).toBe(3);
    run({ command: "str_replace", path: "/memories/user.md", old_str: "zzz", new_str: "b" });
    run({ command: "create", path: "/memories/user.md", file_text: "x".repeat(999) });
    expect(versions()).toBe(3);
    expect(memory.read("comp", "user.md")?.content).toBe("b\nc");
  });

  it("is logged, done or refused", () => {
    const { db, run } = setup();
    run({ command: "create", path: "/memories/user.md", file_text: "a" });
    run({ command: "view", path: "/memories/none.md" });
    expect(db.prepare("SELECT command, path, ok, run_id FROM memory_ops ORDER BY id").all()).toEqual([
      { command: "create", path: "/memories/user.md", ok: 1, run_id: 7 },
      { command: "view", path: "/memories/none.md", ok: 0, run_id: 7 },
    ]);
  });

  it("leaves nothing behind when it fails half way", () => {
    const { memory, run, versions } = setup();
    memory.write("comp", "a/one.md", "1", { op: "create", source: "t" });
    memory.write("comp", "a/two.md", "x".repeat(150), { op: "create", source: "t" });
    memory.write("comp", "b/two.md", "y".repeat(150), { op: "create", source: "t" });
    const before = versions();
    // Moving a/ into story/ is fine; moving it where b/two.md would collide refuses the whole move.
    expect(run({ command: "rename", old_path: "/memories/a", new_path: "/memories/b" }).ok).toBe(false);
    expect(memory.files("comp").map((file) => file.path)).toEqual(["a/one.md", "a/two.md", "b/two.md"]);
    expect(versions()).toBe(before);
  });
});

describe("history", () => {
  it("puts an earlier version back as a new change", () => {
    const { db, memory } = setup();
    memory.write("comp", "user.md", "first", { op: "create", source: "t" });
    memory.write("comp", "user.md", "second", { op: "manual_edit", source: "manual" });
    const [, oldest] = memory.versions("comp", "user.md");
    memory.revert("comp", oldest!.id);
    expect(memory.read("comp", "user.md")?.content).toBe("first");
    const all = memory.versions("comp", "user.md");
    expect(all.map((version) => version.op)).toEqual(["revert", "manual_edit", "create"]);
    expect(db.prepare("SELECT count(*) AS n FROM memory_versions").get()).toEqual({ n: 3 });
  });

  it("shows what changed line by line", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc\nd")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "B" },
      { kind: "same", text: "c" },
      { kind: "added", text: "d" },
    ]);
  });
});

describe("seeding", () => {
  it("lays out every file once, and never again", () => {
    const memory = createMemory(openDatabase(":memory:"), { ...LIMITS, fileBytes: 8192, storyBytes: 16384 });
    memory.seed("comp");
    memory.write("comp", "user.md", "changed", { op: "manual_edit", source: "manual" });
    memory.seed("comp");
    expect(memory.files("comp")).toHaveLength(SEED_FILES.length);
    expect(memory.read("comp", "user.md")?.content).toBe("changed");
  });
});

describe("the lock", () => {
  it("lets one writer at a time at a companion's memory, so no change is lost", async () => {
    const { memory } = setup();
    memory.write("comp", "count.md", "0", { op: "create", source: "t" });
    const bump = () =>
      withMemoryLock("comp", async () => {
        const n = Number(memory.read("comp", "count.md")!.content);
        await new Promise((resolve) => setTimeout(resolve, 1));
        memory.write("comp", "count.md", String(n + 1), { op: "manual_edit", source: "t" });
      });
    await Promise.all(Array.from({ length: 20 }, bump));
    expect(memory.read("comp", "count.md")?.content).toBe("20");
  });

  it("lets the next one in after a failure", async () => {
    await expect(withMemoryLock("x", () => Promise.reject(new MemoryError("no")))).rejects.toThrow("no");
    await expect(withMemoryLock("x", () => "fine")).resolves.toBe("fine");
  });
});
