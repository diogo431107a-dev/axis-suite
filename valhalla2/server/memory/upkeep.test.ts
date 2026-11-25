import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_SETTINGS, blockText } from "../../shared/protocol.ts";
import { backUp, backups } from "../backup.ts";
import { createChats } from "../chat/chats.ts";
import type { Tree } from "../chat/tree.ts";
import type { MemoryRunRequest, MemoryRunResult, MemoryRunner } from "../claude/memory.ts";
import { createCompanions } from "../companions.ts";
import { openDatabase } from "../db.ts";
import { cleanup, cleanupDue } from "./cleanup.ts";
import { consolidate } from "./consolidate.ts";
import { partsOf, rebuild } from "./rebuild.ts";
import { createMemory } from "./store.ts";

const LIMITS = { fileBytes: 8192, storyBytes: 16384, files: 20, viewChars: 16_000 };
type Command = Anthropic.Beta.BetaMemoryTool20250818Command;

function scriptedModel(
  steps: (request: MemoryRunRequest, call: number) => Command[],
  end: (call: number) => Partial<MemoryRunResult> = () => ({}),
) {
  const asked: MemoryRunRequest[] = [];
  const run: MemoryRunner = async (request) => {
    const call = asked.push(request) - 1;
    for (const command of steps(request, call)) {
      try {
        await request.tool.run(command as never);
      } catch {
        // Told to the model.
      }
    }
    return { stopReason: "end_turn", stopDetails: null, attempts: [], text: "Done.", ...end(call) };
  };
  return { run, asked };
}

function setup() {
  const db = openDatabase(":memory:");
  const companions = createCompanions(db, "odin", DEFAULT_SETTINGS);
  const companion = companions.save("comp-0001", { name: "Wealhtheow", profile: "<personality>Queen.</personality>" });
  const chats = createChats(db, "odin", companions, 5);
  const memory = createMemory(db, LIMITS);
  return { db, companion, chats, memory };
}

const put = (tree: Tree, parentId: number | null, role: "user" | "assistant", said: string): number => {
  const message = tree.add({ parentId, role, content: [{ type: "text", text: said }], isGreeting: parentId === null });
  tree.setLeaf(message.id);
  return message.id;
};

const note = (fact: string): Command => ({
  command: "insert",
  path: "/memories/user.md",
  insert_line: 3,
  insert_text: `- ${fact}`,
});

describe("the tidy-up", () => {
  it("is due after enough consolidations, or after enough days if memory changed", () => {
    const { db, companion } = setup();
    const rule = { every: 3, days: 7 };
    const run = (kind: string, ok: number, at: string) =>
      db
        .prepare("INSERT INTO memory_runs (space, kind, model, ok, started_at) VALUES (?, ?, 'm', ?, ?)")
        .run(companion.id, kind, ok, at);
    const now = Date.parse("2026-11-13T12:00:00.000Z");
    expect(cleanupDue(db, companion.id, rule, now)).toBe(false);
    run("consolidate", 1, "2026-11-13T10:00:00.000Z");
    expect(cleanupDue(db, companion.id, rule, now)).toBe(false);
    expect(cleanupDue(db, companion.id, rule, now + 8 * 24 * 60 * 60_000)).toBe(true);
    run("consolidate", 1, "2026-11-13T10:30:00.000Z");
    run("consolidate", 0, "2026-11-13T10:40:00.000Z");
    expect(cleanupDue(db, companion.id, rule, now)).toBe(false);
    run("consolidate", 1, "2026-11-13T11:00:00.000Z");
    expect(cleanupDue(db, companion.id, rule, now)).toBe(true);
    run("cleanup", 1, "2026-11-13T11:30:00.000Z");
    expect(cleanupDue(db, companion.id, rule, now)).toBe(false);
  });

  it("rewrites the files on a copy and swaps them in", async () => {
    const { db, companion, memory } = setup();
    memory.write(companion.id, "user.md", "# The user\n\n- Likes rain.\n- Likes rain a lot.\n", {
      op: "create",
      source: "t",
    });
    const model = scriptedModel(() => [
      { command: "create", path: "/memories/user.md", file_text: "# The user\n\n- Likes rain a lot.\n" },
    ]);
    const outcome = await cleanup({ db, memory, limits: LIMITS, run: model.run, maxIterations: 8 }, companion);
    expect(outcome).toMatchObject({ kind: "done" });
    expect(memory.read(companion.id, "user.md")?.content).toBe("# The user\n\n- Likes rain a lot.\n");
    expect(model.asked[0]!.prompt).toMatch(/<memory_file path="user.md" size="[\d.]+B" limit="8.0K">/);
    expect(memory.versions(companion.id, "user.md")[0]).toMatchObject({ source: "cleanup" });
  });

  it("keeps nothing when it changes the files themselves", async () => {
    const { db, companion, memory } = setup();
    const before = memory.files(companion.id);
    const model = scriptedModel(() => [{ command: "delete", path: "/memories/world.md" }]);
    const outcome = await cleanup({ db, memory, limits: LIMITS, run: model.run, maxIterations: 8 }, companion);
    expect(outcome).toMatchObject({ kind: "failed", error: expect.stringContaining("added, renamed or deleted") });
    expect(memory.files(companion.id)).toEqual(before);
  });
});

describe("rebuilding from every chat", () => {
  it("reads every chat's selected path, in order, and swaps in the result at the end", async () => {
    const { db, companion, chats, memory } = setup();
    chats.create({ id: "chat-0001", companionId: companion.id });
    const first = chats.tree("chat-0001");
    const greeting = put(first, null, "assistant", "Welcome.");
    const mine = put(first, greeting, "user", "I have a cat called Tom.");
    put(first, mine, "assistant", "A rejected reply about dogs.");
    put(first, mine, "assistant", "A cat! Tell me more.");
    chats.create({ id: "chat-0002", companionId: companion.id });
    const second = chats.tree("chat-0002");
    const deleted = put(second, null, "assistant", "Something deleted.");
    second.remove(deleted);
    put(second, null, "assistant", "Back again?");
    memory.write(companion.id, "user.md", "# The user\n\nOld, wrong facts.\n", { op: "manual_edit", source: "manual" });

    const model = scriptedModel((request, call) => [
      note(`From step ${call}: ${request.prompt.includes("Tom") ? "Tom" : "other"}`),
    ]);
    const outcome = await rebuild(
      { db, memory, limits: LIMITS, run: model.run, maxIterations: 8, partTokens: 20_000 },
      companion,
    );
    expect(outcome).toMatchObject({ kind: "done", summary: "Rebuilt from 2 chats in 2 steps." });

    expect(model.asked[0]!.prompt).toContain("A cat! Tell me more.");
    expect(model.asked[0]!.prompt).not.toContain("A rejected reply about dogs.");
    expect(model.asked[1]!.prompt).not.toContain("Something deleted.");
    expect(model.asked[0]!.system).toContain("rebuilding this memory from scratch");

    const user = memory.read(companion.id, "user.md")!.content;
    expect(user).not.toContain("Old, wrong facts.");
    expect(user).toContain("From step 0: Tom");
    expect(memory.versions(companion.id, "user.md")[0]).toMatchObject({ op: "rebuild", source: "rebuild" });
    // The old memory is still in the history.
    expect(memory.versions(companion.id, "user.md").some((version) => version.content?.includes("Old, wrong"))).toBe(
      true,
    );
    expect(db.prepare("SELECT count(*) AS n FROM memory_files WHERE space LIKE 'rebuild:%'").get()).toEqual({ n: 0 });
  });

  it("changes nothing when a step fails", async () => {
    const { db, companion, chats, memory } = setup();
    for (const id of ["chat-0001", "chat-0002"]) {
      chats.create({ id, companionId: companion.id });
      put(chats.tree(id), null, "assistant", `Hello from ${id}.`);
    }
    const before = memory.files(companion.id);
    const model = scriptedModel(
      () => [note("partial")],
      (call) => (call === 1 ? { stopReason: "refusal" } : {}),
    );
    const outcome = await rebuild(
      { db, memory, limits: LIMITS, run: model.run, maxIterations: 8, partTokens: 20_000 },
      companion,
    );
    expect(outcome).toMatchObject({ kind: "failed" });
    expect(memory.files(companion.id)).toEqual(before);
    const runs = db.prepare("SELECT ok FROM memory_runs ORDER BY id").all() as { ok: number }[];
    expect(runs.map((run) => run.ok)).toEqual([0, 0]);
  });

  it("marks every selected path as in memory, and nothing else", async () => {
    const { db, companion, chats, memory } = setup();
    chats.create({ id: "chat-0001", companionId: companion.id });
    const tree = chats.tree("chat-0001");
    const greeting = put(tree, null, "assistant", "Welcome.");
    const other = put(tree, greeting, "user", "Left behind.");
    tree.branchFrom(greeting);
    const kept = put(tree, greeting, "user", "Kept.");
    await rebuild(
      { db, memory, limits: LIMITS, run: scriptedModel(() => []).run, maxIterations: 8, partTokens: 20_000 },
      companion,
    );
    const filed = (id: number) =>
      (db.prepare("SELECT consolidated_at FROM messages WHERE id = ?").get(id) as { consolidated_at: string | null })
        .consolidated_at !== null;
    expect([filed(greeting), filed(kept), filed(other)]).toEqual([true, true, false]);
    // Nothing left for an ordinary consolidation to do.
    expect(
      await consolidate(
        { db, memory, limits: LIMITS, run: scriptedModel(() => []).run, maxIterations: 8 },
        "chat-0001",
        companion,
      ),
    ).toMatchObject({ kind: "nothing" });
  });

  it("reads a long chat a part at a time", () => {
    const message = (id: number) => ({
      id,
      parentId: id - 1 || null,
      role: id % 2 ? ("assistant" as const) : ("user" as const),
      content: [{ type: "text", text: "x".repeat(396) }],
      instruction: null,
      isGreeting: id === 1,
      at: "",
      editedAt: null,
      reply: null,
    });
    const parts = partsOf(
      Array.from({ length: 10 }, (_, n) => message(n + 1)),
      330,
    );
    expect(parts.map((part) => part.length)).toEqual([3, 3, 3, 1]);
    expect(parts.flat().map((m) => m.content.map(blockText).join("").length)).toHaveLength(10);
  });
});

describe("backups", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("writes a copy that opens and passes SQLite's integrity check", () => {
    const dir = mkdtempSync(join(tmpdir(), "valhalla2-backup-"));
    dirs.push(dir);
    const db = openDatabase(join(dir, "valhalla2.db"));
    createCompanions(db, "odin", DEFAULT_SETTINGS).save("comp-0001", { name: "Wealhtheow" });
    const made = backUp(db, join(dir, "backups"), 14, new Date("2026-11-13T10:00:00Z"));
    expect(made.day).toBe("2026-11-13");
    const copy = new DatabaseSync(made.file, { readOnly: true });
    expect(copy.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    expect(copy.prepare("SELECT name FROM companions").all()).toEqual([{ name: "Wealhtheow" }]);
    copy.close();
    db.close();
  });

  it("replaces today's copy, and keeps only the newest", () => {
    const dir = mkdtempSync(join(tmpdir(), "valhalla2-backup-"));
    dirs.push(dir);
    const db = openDatabase(":memory:");
    const into = join(dir, "backups");
    for (let day = 1; day <= 5; day++) backUp(db, into, 3, new Date(`2026-11-0${day}T10:00:00Z`));
    backUp(db, into, 3, new Date("2026-11-05T18:00:00Z"));
    writeFileSync(join(into, "something-else.db"), "");
    expect(backups(into).map((backup) => backup.day)).toEqual(["2026-11-05", "2026-11-04", "2026-11-03"]);
  });
});
