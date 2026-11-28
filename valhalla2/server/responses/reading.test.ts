import { describe, expect, it } from "vitest";
import type { Response } from "openai/resources/responses/responses";
import { readOnItsApi } from "../chat/write.ts";
import { claudeReadingRequest } from "../claude/reading.ts";
import { StoreError } from "../errors.ts";
import type { ReadingAsk } from "../reading.ts";
import { TONE_SCHEMA } from "../tone/request.ts";
import { GROK } from "../grok/client.ts";
import { readingOf, readingRequest } from "./reading.ts";

const ask: ReadingAsk = {
  provider: "xai",
  model: "grok-4.7",
  effort: "max",
  system: "Direct the reading.",
  background: '<profile name="Freya">Gold hair.</profile>',
  moment: "<chat>…</chat>",
  schema: TONE_SCHEMA as unknown as Record<string, unknown>,
  name: "tone",
  what: "this reply",
  cacheKey: "tone:comp-0001",
};

const response = (over: Partial<Response>): Response =>
  ({
    id: "resp_1",
    model: "grok-4.7",
    status: "completed",
    output: [],
    usage: { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 0 } },
    ...over,
  }) as unknown as Response;

describe("a reading on Grok", () => {
  it("sends effort as Grok takes it, the profile first, a cache key, and keeps nothing on xAI", () => {
    const request = readingRequest(GROK, ask);
    expect(request.model).toBe("grok-4.7");
    expect(request.reasoning).toEqual({ effort: "xhigh" });
    expect(request.store).toBe(false);
    expect(request.prompt_cache_key).toBe("tone:comp-0001");
    expect(request.input).toEqual([
      { role: "system", content: "Direct the reading." },
      { role: "user", content: '<profile name="Freya">Gold hair.</profile>\n\n<chat>…</chat>' },
    ]);
    expect(request.text?.format).toMatchObject({ type: "json_schema", name: "tone", strict: true });
  });

  it("reads Grok's answer, and refuses one that isn't readable", () => {
    const answered = response({
      output: [
        {
          type: "message",
          id: "msg_1",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: '{"lines":[]}', annotations: [] }],
        },
      ] as unknown as Response["output"],
    });
    expect(readingOf(GROK, answered, ask).raw).toEqual({ lines: [] });
    const garbled = response({
      output: [
        {
          type: "message",
          id: "msg_1",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "not json", annotations: [] }],
        },
      ] as unknown as Response["output"],
    });
    expect(() => readingOf(GROK, garbled, ask)).toThrow(StoreError);
  });

  it("is never sent for a model of the other API", async () => {
    await expect(readOnItsApi({ ...ask, model: "claude-haiku-5-5" })).rejects.toThrow(/isn't a model of this/);
    await expect(readOnItsApi({ ...ask, provider: "anthropic" })).rejects.toThrow(/isn't a model of this/);
  });
});

describe("a reading on Claude", () => {
  it("sends the companion's effort and the profile first, cached", () => {
    const request = claudeReadingRequest({ ...ask, provider: "anthropic", model: "claude-haiku-5-5", effort: "high" });
    expect(request.model).toBe("claude-haiku-5-5");
    expect(request.output_config).toMatchObject({ effort: "high", format: { type: "json_schema" } });
    expect(request.messages[0]!.content).toEqual([
      { type: "text", text: '<profile name="Freya">Gold hair.</profile>', cache_control: { type: "ephemeral" } },
      { type: "text", text: "<chat>…</chat>" },
    ]);
  });
});
