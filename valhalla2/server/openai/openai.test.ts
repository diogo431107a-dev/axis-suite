import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { Response } from "openai/resources/responses/responses";
import { dollarsFor, dollarsOf } from "../../shared/price.ts";
import { DEFAULT_SETTINGS, hasFallback, providerOf } from "../../shared/protocol.ts";
import { readOnItsApi } from "../chat/write.ts";
import { settings as checkSettings } from "../check.ts";
import { openDatabase } from "../db.ts";
import { StoreError } from "../errors.ts";
import { createMemory } from "../memory/store.ts";
import { memoryTool } from "../memory/tool.ts";
import { apiErrorOf } from "../responses/api.ts";
import { memoryRequestFor, runResponsesMemory } from "../responses/memory.ts";
import { readingOf, readingRequest } from "../responses/reading.ts";
import { replyOf, requestFor } from "../responses/reply.ts";
import { OPENAI } from "./client.ts";
import { loadOpenAiKey } from "./key.ts";
import { openAiContextWindow } from "./tokens.ts";

const gpt = { ...DEFAULT_SETTINGS, model: "gpt-6-luna", memoryModel: "gpt-6-luna" };

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const message = (text: string) => ({
  type: "message",
  id: "msg_1",
  role: "assistant",
  status: "completed",
  content: [{ type: "output_text", text, annotations: [] }],
});

/** A finished response, as OpenAI hands it back: cached and written tokens inside input_tokens. */
const response = (over: Partial<Response> = {}): Response =>
  ({
    id: "resp_1",
    object: "response",
    model: "gpt-6-luna",
    status: "completed",
    incomplete_details: null,
    output: [{ type: "reasoning", id: "rs_1", summary: [], encrypted_content: "opaque" }, message("Well met.")],
    usage: {
      input_tokens: 10_000,
      input_tokens_details: { cached_tokens: 6_000, cache_write_tokens: 3_000 },
      output_tokens: 400,
      output_tokens_details: { reasoning_tokens: 300 },
      total_tokens: 10_400,
    },
    ...over,
  }) as unknown as Response;

describe("which API a gpt- model is on", () => {
  it("sends gpt- ids to OpenAI, with no fallback", () => {
    expect(providerOf("gpt-6-luna")).toBe("openai");
    expect(providerOf("gpt-6.2-sol")).toBe("openai");
    expect(providerOf("grok-4.7")).toBe("xai");
    expect(providerOf("claude-haiku-5-5")).toBe("anthropic");
    expect(hasFallback("gpt-6-luna")).toBe(false);
  });

  it("keeps every helper model on GPT, and takes no temperature", () => {
    expect(checkSettings({ model: "gpt-6-luna" })).toMatchObject({
      memoryModel: "gpt-6-luna",
      toneModel: "gpt-6-luna",
      sceneModel: "gpt-6-luna",
      temperature: null,
    });
    // One of another API, or left out, becomes the chat model; one of GPT's own is kept.
    expect(checkSettings({ model: "gpt-6-luna", memoryModel: "claude-sonnet-5-5" }).memoryModel).toBe("gpt-6-luna");
    expect(checkSettings({ model: "gpt-6-luna", memoryModel: "grok-4.7" }).memoryModel).toBe("gpt-6-luna");
    expect(checkSettings({ model: "gpt-6-luna", memoryModel: "gpt-6.2-sol" }).memoryModel).toBe("gpt-6.2-sol");
    expect(() => checkSettings({ model: "gpt-6-luna", temperature: 0.5 })).toThrow(/GPT's models/);
    // And a Claude companion can't name a GPT model for its memory.
    expect(() => checkSettings({ memoryModel: "gpt-6-luna" })).toThrow(/has to be a Claude model/);
  });
});

describe("the OpenAI API key", () => {
  function credentials(contents?: string): string {
    const dir = mkdtempSync(join(tmpdir(), "valhalla2-openai-"));
    made.push(dir);
    if (contents !== undefined) writeFileSync(join(dir, "openai-api-key"), contents);
    return dir;
  }

  it("comes from its own systemd credential, trimmed", () => {
    expect(loadOpenAiKey({ CREDENTIALS_DIRECTORY: credentials("sk-from-file\n") })).toEqual({
      apiKey: "sk-from-file",
      from: "credential",
    });
  });

  it("is optional, and never the xAI key", () => {
    expect(loadOpenAiKey({ CREDENTIALS_DIRECTORY: credentials() })).toBeNull();
    expect(loadOpenAiKey({ CREDENTIALS_DIRECTORY: credentials(" \n") })).toBeNull();
    expect(loadOpenAiKey({ XAI_API_KEY: "xai-key" })).toBeNull();
  });

  it("comes from OPENAI_API_KEY in development", () => {
    expect(loadOpenAiKey({ OPENAI_API_KEY: " sk-from-env " })).toEqual({ apiKey: "sk-from-env", from: "environment" });
  });
});

describe("the request that goes to OpenAI", () => {
  const messages = [{ role: "user", content: "Hail." }] as unknown as Anthropic.Beta.BetaMessageParam[];

  it("sends every effort as it is, max included, and never a temperature", () => {
    const request = requestFor(
      OPENAI,
      [{ type: "text", text: "Proud." }],
      messages,
      { ...gpt, effort: "max" },
      "chat-1",
    );
    expect(request).toMatchObject({
      model: "gpt-6-luna",
      reasoning: { effort: "max" },
      store: false,
      stream: true,
      prompt_cache_key: "chat-1",
    });
    expect(request.input).toEqual([
      { role: "system", content: "Proud." },
      { role: "user", content: "Hail." },
    ]);
    expect(requestFor(OPENAI, [], messages, { ...gpt, temperature: 0.5 }).temperature).toBeUndefined();
    expect(requestFor(OPENAI, [], messages, { ...gpt, effort: "xhigh" }).reasoning).toEqual({ effort: "xhigh" });
  });

  it("asks a memory run and a reading on GPT's own efforts", () => {
    expect(memoryRequestFor({ settings: gpt } as never, []).model).toBe("gpt-6-luna");
    const ask = {
      provider: "openai" as const,
      model: "gpt-6-luna",
      effort: "max" as const,
      system: "Read.",
      background: "<profile/>",
      moment: "<chat/>",
      schema: { type: "object" },
      name: "tone",
      what: "this reply",
      cacheKey: "tone:comp-0001",
    };
    expect(readingRequest(OPENAI, ask).reasoning).toEqual({ effort: "max" });
    expect(() => readingOf(OPENAI, response({ output: [message("not json")] as never }), ask)).toThrow(
      /GPT's reading of this reply/,
    );
  });

  it("is never sent for a model of another API", async () => {
    const ask = { provider: "openai", model: "claude-haiku-5-5" } as never;
    await expect(readOnItsApi(ask)).rejects.toThrow(/isn't a model of this/);
  });
});

describe("what is stored from a GPT reply", () => {
  it("keeps cached and written tokens apart from the rest of the input", () => {
    const { content, details } = replyOf(response(), "gpt-6-luna");
    expect(content).toEqual([{ type: "text", text: "Well met." }]);
    expect(details.usage).toEqual({
      input_tokens: 1_000,
      output_tokens: 400,
      cache_read_input_tokens: 6_000,
      cache_creation_input_tokens: 3_000,
      cache_creation_1h_input_tokens: null,
    });
  });

  it("prices it at Luna's rates, a cache write at 1.25 times the input", () => {
    const { details } = replyOf(response(), "gpt-6-luna");
    const expected = (1_000 * 0.1 + 3_000 * 0.1 * 1.25 + 6_000 * 0.01 + 400 * 0.5) / 1_000_000;
    expect(dollarsOf(details)).toBeCloseTo(expected, 12);
  });

  it("prices a prompt over 272K tokens at the long rate", () => {
    const usage = {
      input_tokens: 300_000,
      output_tokens: 1_000,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_creation_1h_input_tokens: null,
    };
    expect(dollarsFor("gpt-6-luna", usage)).toBeCloseTo((300_000 * 0.2 + 1_000 * 0.75) / 1_000_000, 12);
    expect(dollarsFor("gpt-6-luna", { ...usage, input_tokens: 272_000 })).toBeCloseTo(
      (272_000 * 0.1 + 1_000 * 0.5) / 1_000_000,
      12,
    );
  });

  it("keeps a filtered reply as a refusal", () => {
    const { details } = replyOf(
      response({ status: "incomplete", incomplete_details: { reason: "content_filter" } }),
      "gpt-6-luna",
    );
    expect(details.stopReason).toBe("refusal");
  });

  it("knows Luna's window, and no window for a model it hasn't heard of", async () => {
    expect(await openAiContextWindow("gpt-6-luna")).toBe(1_050_000);
    expect(await openAiContextWindow("gpt-7")).toBeNull();
  });

  it("names OpenAI when the API fails", () => {
    expect(apiErrorOf("OpenAI", new Error("not the SDK's"))).toBeNull();
  });
});

describe("a memory run on GPT", () => {
  it("carries out the memory function with the same tool, on GPT's memory model", async () => {
    const db = openDatabase(":memory:");
    const limits = { fileBytes: 8192, storyBytes: 16384, files: 20, viewChars: 16_000 };
    const memory = createMemory(db, limits);
    memory.seed("comp-0001");
    const tool = memoryTool({
      db,
      memory,
      limits,
      space: "comp-0001",
      source: "test",
      runId: null,
      chatId: null,
      mode: "canon",
    });
    const asked: string[] = [];
    const answers = [
      response({
        output: [
          {
            type: "function_call",
            id: "fc_0",
            call_id: "call_0",
            name: "memory",
            arguments: JSON.stringify({
              command: "insert",
              path: "/memories/user.md",
              insert_line: 3,
              insert_text: "- Crossed the sea.",
            }),
            status: "completed",
          },
        ] as never,
      }),
      response({ output: [message("Added the crossing.")] as never }),
    ];
    const result = await runResponsesMemory(
      OPENAI,
      { system: "Keep memory.", prompt: "<new_messages/>", tool, settings: gpt, maxIterations: 4 },
      (body) => {
        asked.push(body.model as string);
        return Promise.resolve(answers.shift()!);
      },
    );
    expect(result).toMatchObject({ stopReason: "end_turn", text: "Added the crossing." });
    expect(asked).toEqual(["gpt-6-luna", "gpt-6-luna"]);
    expect(memory.read("comp-0001", "user.md")?.content).toContain("- Crossed the sea.");
    expect(result.attempts[0]).toMatchObject({ model: "gpt-6-luna", cache_creation_input_tokens: 3_000 });
  });

  it("is refused, not sent, without a key", () => {
    // The test run has no OPENAI_API_KEY, so the client refuses with what the page shows.
    if (process.env.OPENAI_API_KEY) return;
    expect(() => OPENAI.client()).toThrow(StoreError);
    expect(() => OPENAI.client()).toThrow(/No OpenAI API key/);
  });
});
