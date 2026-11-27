import { describe, expect, it } from "vitest";
import type {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import { DEFAULT_SETTINGS, type ChatMode } from "../../shared/protocol.ts";
import { openDatabase } from "../db.ts";
import { createMemory } from "../memory/store.ts";
import { memoryTool } from "../memory/tool.ts";
import { MEMORY_FUNCTION, memoryRequestFor, runGrokMemoryModel, type ResponsesCall } from "./memory.ts";

const LIMITS = { fileBytes: 8192, storyBytes: 16384, files: 20, viewChars: 16_000 };
const settings = { ...DEFAULT_SETTINGS, model: "grok-4.7", memoryModel: "grok-4.7" };

/** A response that calls the memory function once per command, or says it is done. */
const answer = (
  calls: Record<string, unknown>[],
  over: Partial<Response> = {},
  text = calls.length ? "" : "Added her sister.",
): Response =>
  ({
    id: "resp",
    object: "response",
    model: "grok-4.7",
    status: "completed",
    incomplete_details: null,
    output: [
      { type: "reasoning", id: "rs", summary: [], encrypted_content: "opaque" },
      ...calls.map((args, n) => ({
        type: "function_call",
        id: `fc_${n}`,
        call_id: `call_${n}`,
        name: "memory",
        arguments: JSON.stringify(args),
        status: "completed",
      })),
      ...(text
        ? [
            {
              type: "message",
              id: "msg",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text, annotations: [] }],
            },
          ]
        : []),
    ],
    usage: {
      input_tokens: 3000,
      input_tokens_details: { cached_tokens: 2000 },
      output_tokens: 200,
      output_tokens_details: { reasoning_tokens: 100 },
      total_tokens: 3200,
    },
    ...over,
  }) as unknown as Response;

/** xAI as a script: each request gets the next answer, and every request is kept. */
function scripted(...answers: Response[]) {
  const asked: ResponseCreateParamsNonStreaming[] = [];
  const call: ResponsesCall = (body) => {
    // A copy: the run keeps adding to its input after the request has gone.
    asked.push({ ...body, input: [...(body.input as ResponseInputItem[])] });
    const next = answers.shift();
    return next ? Promise.resolve(next) : Promise.reject(new Error("asked once too often"));
  };
  return { call, asked };
}

function setup(mode: ChatMode = "canon", maxIterations = 8) {
  const db = openDatabase(":memory:");
  const memory = createMemory(db, LIMITS);
  memory.seed("comp-0001");
  const tool = memoryTool({
    db,
    memory,
    limits: LIMITS,
    space: "comp-0001",
    source: "test",
    runId: null,
    chatId: null,
    mode,
  });
  const request = { system: "Keep memory.", prompt: "<new_messages>…</new_messages>", tool, settings, maxIterations };
  return { db, memory, request: { ...request, cacheKey: "memory-run:7" } };
}

const ops = (db: ReturnType<typeof openDatabase>) =>
  db.prepare("SELECT command, path, ok FROM memory_ops ORDER BY id").all() as {
    command: string;
    path: string;
    ok: number;
  }[];

describe("a memory run on Grok", () => {
  it("asks with the memory function, its own cache key, and nothing kept on xAI", () => {
    const { request } = setup();
    const body = memoryRequestFor(request, []);
    expect(body.model).toBe("grok-4.7");
    expect(body.tools).toEqual([MEMORY_FUNCTION]);
    expect(body.store).toBe(false);
    expect(body.prompt_cache_key).toBe("memory-run:7");
    expect(body.include).toEqual(["reasoning.encrypted_content"]);
    expect(body.reasoning).toEqual({ effort: "medium" });
    expect(body).not.toHaveProperty("stop");
  });

  it("carries out each call with the memory tool, and sends back what it came to", async () => {
    const { db, memory, request } = setup();
    const xai = scripted(
      answer([
        { command: "insert", path: "/memories/user.md", insert_line: 3, insert_text: "- Has a sister, Hild." },
        { command: "view", path: "/memories/user.md" },
      ]),
      answer([]),
    );
    const result = await runGrokMemoryModel(request, xai.call);
    expect(result).toMatchObject({ stopReason: "end_turn", text: "Added her sister." });
    expect(memory.read("comp-0001", "user.md")?.content).toContain("- Has a sister, Hild.");
    expect(xai.asked).toHaveLength(2);
    const second = xai.asked[1]!.input as ResponseInputItem[];
    expect(second.slice(0, 2)).toEqual([
      { role: "system", content: "Keep memory." },
      { role: "user", content: "<new_messages>…</new_messages>" },
    ]);
    // Its reasoning goes back with the calls, so it keeps its train of thought.
    expect(second).toContainEqual(expect.objectContaining({ type: "reasoning", encrypted_content: "opaque" }));
    expect(second).toContainEqual({
      type: "function_call_output",
      call_id: "call_0",
      output: "The file /memories/user.md has been edited.",
    });
    expect(second).toContainEqual(
      expect.objectContaining({ call_id: "call_1", output: expect.stringContaining("Has a sister, Hild.") }),
    );
    expect(ops(db)).toEqual([
      { command: "insert", path: "/memories/user.md", ok: 1 },
      { command: "view", path: "/memories/user.md", ok: 1 },
    ]);
  });

  it("tells the model why a command was refused, and lets it carry on", async () => {
    const { db, memory, request } = setup("one-shot");
    const before = memory.read("comp-0001", "world.md")?.content;
    const xai = scripted(
      answer([
        { command: "create", path: "/memories/world.md", file_text: "# World\n- A pirate ship." },
        { command: "str_replace", path: "/memories/user.md", old_str: "not there", new_str: "x" },
        { command: "fly", path: "/memories/user.md" },
        { command: "insert", path: "/memories/user.md" },
      ]),
      answer([]),
    );
    const result = await runGrokMemoryModel(request, xai.call);
    expect(result.stopReason).toBe("end_turn");
    // The one-shot lock holds on Grok exactly as on Claude.
    expect(memory.read("comp-0001", "world.md")?.content).toBe(before);
    const outputs = (xai.asked[1]!.input as ResponseInputItem[])
      .filter((item) => "type" in item && item.type === "function_call_output")
      .map((item) => (item as { output: string }).output);
    expect(outputs[0]).toMatch(/world\.md is read-only for this chat/);
    expect(outputs[1]).toMatch(/did not appear verbatim/);
    expect(outputs[2]).toMatch(/unknown command "fly"/);
    expect(outputs[3]).toMatch(/^Error: /);
    expect(ops(db).filter((op) => op.ok === 0)).toHaveLength(3);
  });

  it("stops on tool use when it runs out of steps", async () => {
    const { request } = setup("canon", 2);
    const view = { command: "view", path: "/memories" };
    const xai = scripted(answer([view]), answer([view]), answer([]));
    const result = await runGrokMemoryModel(request, xai.call);
    expect(result.stopReason).toBe("tool_use");
    expect(xai.asked).toHaveLength(2);
    expect(result.attempts).toHaveLength(2);
  });

  it("reports a filtered response as a refusal", async () => {
    const { request } = setup();
    const xai = scripted(
      answer([], { status: "incomplete", incomplete_details: { reason: "content_filter" } }, "Can't help with that."),
    );
    const result = await runGrokMemoryModel(request, xai.call);
    expect(result.stopReason).toBe("refusal");
    expect(result.stopDetails?.category).toBe("content_filter");
  });

  it("counts every request, with the cached tokens kept apart", async () => {
    const { request } = setup();
    const xai = scripted(answer([{ command: "view", path: "/memories" }]), answer([]));
    const result = await runGrokMemoryModel(request, xai.call);
    expect(result.attempts).toEqual([
      expect.objectContaining({
        model: "grok-4.7",
        input_tokens: 1000,
        cache_read_input_tokens: 2000,
        output_tokens: 200,
      }),
      expect.objectContaining({ model: "grok-4.7", input_tokens: 1000, cache_read_input_tokens: 2000 }),
    ]);
  });
});
