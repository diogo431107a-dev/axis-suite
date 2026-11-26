import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { Response, ResponseStreamEvent } from "openai/resources/responses/responses";
import { dollarsOf } from "../../shared/price.ts";
import { DEFAULT_SETTINGS, hasFallback, providerOf } from "../../shared/protocol.ts";
import { memoryModel, settings as checkSettings } from "../check.ts";
import { StoreError } from "../errors.ts";
import type { SystemBlock } from "../prompt.ts";
import { cutReply, eventOf, replyOf, requestFor, stopWatch } from "./reply.ts";

const grokSettings = { ...DEFAULT_SETTINGS, model: "grok-4.7" };

const system: SystemBlock[] = [
  { type: "text", text: "<personality>Proud.</personality>" },
  { type: "text", text: "<memory>Eadric is the cup-bearer.</memory>", cache_control: { type: "ephemeral", ttl: "1h" } },
];

const messages = [
  { role: "user", content: "[The chat begins.]" },
  { role: "system", content: "Greet him." },
  {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "", signature: "abc" },
      { type: "text", text: "Sit down, " },
      { type: "text", text: "Eadric." },
    ],
  },
  { role: "assistant", content: [{ type: "redacted_thinking", data: "xyz" }] },
  { role: "user", content: [{ type: "text", text: "My lord." }] },
] as unknown as Anthropic.Beta.BetaMessageParam[];

/** A finished response, as the API hands it back. */
const response = (over: Partial<Response> = {}): Response =>
  ({
    id: "resp_1",
    object: "response",
    model: "grok-4.7",
    status: "completed",
    incomplete_details: null,
    output: [
      { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "opaque" },
      {
        type: "message",
        id: "msg_1",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "Sit down, Eadric.", annotations: [] }],
      },
    ],
    usage: {
      input_tokens: 5000,
      input_tokens_details: { cached_tokens: 4096 },
      output_tokens: 300,
      output_tokens_details: { reasoning_tokens: 250 },
      total_tokens: 5300,
    },
    ...over,
  }) as unknown as Response;

describe("which API a model is on", () => {
  it("sends grok- ids to xAI and everything else to Claude", () => {
    expect(providerOf("grok-4.7")).toBe("xai");
    expect(providerOf("claude-opus-5-5")).toBe("anthropic");
    expect(providerOf("some-other-model")).toBe("anthropic");
  });

  it("has no fallback for Grok", () => {
    expect(hasFallback("grok-4.7")).toBe(false);
    expect(hasFallback("claude-opus-5-5")).toBe(true);
  });

  it("keeps the memory model on Claude", () => {
    expect(memoryModel("claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
    expect(() => memoryModel("grok-4.7")).toThrow(StoreError);
    expect(() => checkSettings({ memoryModel: "grok-4.7" })).toThrow(StoreError);
    expect(checkSettings({ model: "grok-4.7" }).model).toBe("grok-4.7");
  });
});

describe("the request that goes to Grok", () => {
  it("sends the system blocks, then each message as text only", () => {
    const request = requestFor(system, messages, grokSettings, "chat-1");
    expect(request.model).toBe("grok-4.7");
    expect(request.input).toEqual([
      { role: "system", content: "<personality>Proud.</personality>" },
      { role: "system", content: "<memory>Eadric is the cup-bearer.</memory>" },
      { role: "user", content: "[The chat begins.]" },
      { role: "system", content: "Greet him." },
      // The thinking block is dropped; a message with nothing but thinking is left out.
      { role: "assistant", content: "Sit down, Eadric." },
      { role: "user", content: "My lord." },
    ]);
  });

  it("always sends effort, sends max as xhigh, and keeps nothing on xAI", () => {
    expect(requestFor(system, messages, grokSettings).reasoning).toEqual({ effort: "low" });
    const request = requestFor(system, messages, { ...grokSettings, effort: "max", maxTokens: 2048 }, "chat-1");
    expect(request.reasoning).toEqual({ effort: "xhigh" });
    expect(request.max_output_tokens).toBe(2048);
    expect(request.store).toBe(false);
    expect(request.stream).toBe(true);
    expect(request.prompt_cache_key).toBe("chat-1");
  });

  it("never sends stop sequences, cache breakpoints or temperature", () => {
    const request = requestFor(system, messages, { ...grokSettings, stopSequences: ["Eadric:"] }) as unknown as Record<
      string,
      unknown
    >;
    expect(request.stop).toBeUndefined();
    expect(request.cache_control).toBeUndefined();
    expect(request.temperature).toBeUndefined();
    expect(request.prompt_cache_key).toBeUndefined();
  });
});

describe("what the page is told while Grok writes", () => {
  it("says when reasoning starts and passes text on", () => {
    expect(eventOf({ type: "response.reasoning_text.delta", delta: "hm" } as ResponseStreamEvent)).toEqual({
      type: "thinking",
    });
    expect(
      eventOf({ type: "response.output_item.added", item: { type: "reasoning" } } as unknown as ResponseStreamEvent),
    ).toEqual({ type: "thinking" });
    expect(eventOf({ type: "response.output_text.delta", delta: "Sit" } as ResponseStreamEvent)).toEqual({
      type: "delta",
      text: "Sit",
    });
    expect(eventOf({ type: "response.created" } as ResponseStreamEvent)).toBeNull();
  });
});

describe("stop sequences, applied by Valhalla 2", () => {
  it("passes text straight on when there are none", () => {
    const watch = stopWatch([]);
    expect(watch.feed("Sit down.")).toEqual({ show: "Sit down.", stopped: false });
    expect(watch.flush()).toBe("");
    expect(watch.text).toBe("Sit down.");
  });

  it("cuts the reply where a stop sequence starts", () => {
    const watch = stopWatch(["Eadric:"]);
    expect(watch.feed("Sit down.\nEadric: Thank")).toEqual({ show: "Sit down.\n", stopped: true });
    expect(watch.text).toBe("Sit down.\n");
  });

  it("holds back what could be the start of one, across pieces", () => {
    const watch = stopWatch(["Eadric:"]);
    expect(watch.feed("Sit down.\nEad")).toEqual({ show: "Sit down.\n", stopped: false });
    expect(watch.feed("ric")).toEqual({ show: "", stopped: false });
    expect(watch.feed(": Thank you")).toEqual({ show: "", stopped: true });
    expect(watch.text).toBe("Sit down.\n");
  });

  it("lets held-back text go once it turns out not to be one", () => {
    const watch = stopWatch(["Eadric:"]);
    expect(watch.feed("Sit, Ead")).toEqual({ show: "Sit, ", stopped: false });
    expect(watch.feed("ric.")).toEqual({ show: "Eadric.", stopped: false });
    expect(watch.feed(" Ea")).toEqual({ show: " ", stopped: false });
    expect(watch.flush()).toBe("Ea");
    expect(watch.text).toBe("Sit, Eadric. Ea");
  });

  it("stops at the earliest of several", () => {
    const watch = stopWatch(["Eadric:", "\n\n"]);
    expect(watch.feed("Sit.\n\nEadric: no")).toEqual({ show: "Sit.", stopped: true });
  });

  it("stores a cut reply as stopped, with its cost unknown", () => {
    const cut = cutReply("Sit down.", "grok-4.7");
    expect(cut.content).toEqual([{ type: "text", text: "Sit down." }]);
    expect(cut.details.stopReason).toBe("stop_sequence");
    expect(cut.details.usage).toBeNull();
    expect(dollarsOf(cut.details)).toBeNull();
  });
});

describe("what is stored from a Grok reply", () => {
  it("keeps the text, not the encrypted reasoning, and splits cached input out", () => {
    const { content, details } = replyOf(response(), "grok-4.7");
    expect(content).toEqual([{ type: "text", text: "Sit down, Eadric." }]);
    expect(details).toEqual({
      model: "grok-4.7",
      stopReason: "end_turn",
      stopDetails: null,
      usage: {
        input_tokens: 904,
        output_tokens: 300,
        cache_read_input_tokens: 4096,
        cache_creation_input_tokens: 0,
        cache_creation_1h_input_tokens: null,
      },
      servedBy: null,
      declinedBy: null,
      attempts: null,
    });
  });

  it("prices it at Grok's rates", () => {
    const { details } = replyOf(response(), "grok-4.7");
    // 904 × $2 + 4096 × $0.50 + 300 × $6, per million.
    expect(dollarsOf(details)).toBeCloseTo((904 * 2 + 4096 * 0.5 + 300 * 6) / 1_000_000, 10);
  });

  it("marks a reply that ran out of room", () => {
    const { details } = replyOf(
      response({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }),
      "grok-4.7",
    );
    expect(details.stopReason).toBe("max_tokens");
  });

  it("keeps a decline as a refusal, with what it said", () => {
    const filtered = replyOf(
      response({ status: "incomplete", incomplete_details: { reason: "content_filter" } }),
      "grok-4.7",
    );
    expect(filtered.details.stopReason).toBe("refusal");
    expect(filtered.details.stopDetails).toEqual({ category: "content_filter", explanation: null });

    const refused = replyOf(
      response({
        output: [
          {
            type: "message",
            id: "msg_1",
            role: "assistant",
            status: "completed",
            content: [{ type: "refusal", refusal: "I can't continue this." }],
          },
        ] as Response["output"],
      }),
      "grok-4.7",
    );
    expect(refused.content).toEqual([]);
    expect(refused.details.stopReason).toBe("refusal");
    expect(refused.details.stopDetails).toEqual({ category: null, explanation: "I can't continue this." });
  });
});
