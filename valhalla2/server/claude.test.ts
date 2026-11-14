import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_SETTINGS } from "../shared/protocol.ts";
import { eventOf, messagesToCount, replyOf, requestFor } from "./claude.ts";
import type { SystemBlock } from "./prompt.ts";

const system: SystemBlock[] = [
  { type: "text", text: "<personality>Proud.</personality>", cache_control: { type: "ephemeral", ttl: "1h" } },
];

const said: Anthropic.Beta.BetaMessageParam = { role: "user", content: [{ type: "text", text: "My lord." }] };

const answered = {
  role: "assistant",
  content: [
    { type: "thinking", thinking: "", signature: "abc" },
    { type: "text", text: "Sit down, Eadric." },
  ],
} as Anthropic.Beta.BetaMessageParam;

/** A finished reply, as the API hands it back. */
const message = (over: Partial<Anthropic.Beta.BetaMessage> = {}): Anthropic.Beta.BetaMessage =>
  ({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text: "Sit down, Eadric." }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    container: null,
    context_management: null,
    diagnostics: null,
    usage: {
      input_tokens: 11,
      output_tokens: 42,
      cache_read_input_tokens: 4096,
      cache_creation_input_tokens: 120,
      cache_creation: null,
      fallback_credit: null,
      inference_geo: null,
      iterations: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: "standard",
      speed: "standard",
    },
    ...over,
  }) as Anthropic.Beta.BetaMessage;

describe("the request that goes out", () => {
  it("sends the system blocks, the messages and the chosen settings", () => {
    const request = requestFor(system, [said, answered], { ...DEFAULT_SETTINGS, maxTokens: 2048, effort: "medium" });
    expect(request.model).toBe("claude-opus-5-5");
    expect(request.max_tokens).toBe(2048);
    expect(request.output_config).toEqual({ effort: "medium" });
    expect(request.system).toBe(system);
    expect(request.messages).toEqual([said, answered]);
  });

  it("leaves the system prompt out when the profile is empty", () => {
    expect(requestFor([], [said], DEFAULT_SETTINGS)).not.toHaveProperty("system");
  });

  it("follows the conversation with a second cache breakpoint", () => {
    const request = requestFor(system, [said], { ...DEFAULT_SETTINGS, cacheTtl: "1h" });
    expect(request.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("asks for thinking the only way these models accept, and never sets a temperature", () => {
    const request = requestFor(system, [said], DEFAULT_SETTINGS);
    expect(request.thinking).toMatchObject({ type: "adaptive" });
    expect(request).not.toHaveProperty("temperature");
    expect(request).not.toHaveProperty("top_p");
    expect(request).not.toHaveProperty("top_k");
  });

  // An edit, a delete or a history that drops its oldest turns changes what earlier thinking was
  // bound to. The API is asked to drop that thinking rather than refuse the request.
  it("asks the API to drop thinking an edited history no longer matches", () => {
    const request = requestFor(system, [said], { ...DEFAULT_SETTINGS, fallbacks: false });
    expect(request.thinking).toEqual({ type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } });
    expect(request.betas).toEqual(["thinking-binding-controls-2026-08-01"]);
  });

  it("asks for a fallback model when the companion allows one", () => {
    const request = requestFor(system, [said], { ...DEFAULT_SETTINGS, fallbacks: true });
    expect(request.fallbacks).toBe("default");
    expect(request.betas).toEqual(["thinking-binding-controls-2026-08-01", "server-side-fallback-2026-07-01"]);
  });

  it("asks for none when it doesn't", () => {
    const request = requestFor(system, [said], { ...DEFAULT_SETTINGS, fallbacks: false });
    expect(request.fallbacks).toBeUndefined();
  });

  it("leaves stop sequences out entirely when there are none", () => {
    expect(requestFor(system, [said], DEFAULT_SETTINGS).stop_sequences).toBeUndefined();
    const withStops = requestFor(system, [said], { ...DEFAULT_SETTINGS, stopSequences: ["\nEadric:"] });
    expect(withStops.stop_sequences).toEqual(["\nEadric:"]);
  });
});

describe("what gets stored after a reply", () => {
  it("keeps the content, the model, how it ended and what it cost", () => {
    const turn = replyOf(message());
    expect(turn.content).toEqual([{ type: "text", text: "Sit down, Eadric." }]);
    expect(turn.details.model).toBe("claude-opus-5-5");
    expect(turn.details.stopReason).toBe("end_turn");
    expect(turn.details.usage).toEqual({
      input_tokens: 11,
      output_tokens: 42,
      cache_read_input_tokens: 4096,
      cache_creation_input_tokens: 120,
      cache_creation_1h_input_tokens: null,
    });
    expect(turn.details.servedBy).toBeNull();
  });

  // A refusal is an answer the API gave, so it is kept like any other turn and shown as it is.
  it("stores a refusal as a turn, with the category and explanation the API named", () => {
    const turn = replyOf(
      message({
        content: [],
        stop_reason: "refusal",
        stop_details: {
          type: "refusal",
          category: "general_harms",
          explanation: "The request was declined.",
          fallback_credit_token: null,
          fallback_has_prefill_claim: null,
          recommended_model: null,
        },
      }),
    );
    expect(turn.details.stopReason).toBe("refusal");
    expect(turn.details.stopDetails).toEqual({ category: "general_harms", explanation: "The request was declined." });
  });

  it("names the model that answered when an earlier one declined", () => {
    const turn = replyOf(
      message({
        model: "claude-opus-4-8",
        content: [
          {
            type: "fallback",
            from: { model: "claude-opus-5-5" },
            to: { model: "claude-opus-4-8" },
            trigger: { type: "refusal", category: "general_harms" },
          },
          { type: "text", text: "Sit down, Eadric." },
        ] as Anthropic.Beta.BetaContentBlock[],
      }),
    );
    expect(turn.details.servedBy).toBe("claude-opus-4-8");
    expect(turn.details.declinedBy).toBe("claude-opus-5-5");
    expect(turn.details.stopReason).toBe("end_turn");
  });

  // For about an hour after a fallback the API goes straight to the fallback model. Those turns
  // carry no fallback block; only their usage says who served them.
  it("marks a turn the API sent straight to the fallback model", () => {
    const entry = {
      input_tokens: 11,
      output_tokens: 42,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 4096,
      cache_creation: { ephemeral_1h_input_tokens: 4096, ephemeral_5m_input_tokens: 0 },
    };
    const turn = replyOf(
      message({
        model: "claude-opus-4-8",
        usage: {
          ...message().usage,
          iterations: [{ ...entry, type: "fallback_message", model: "claude-opus-4-8" }],
        },
      }),
      "claude-opus-5-5",
    );
    expect(turn.details.servedBy).toBe("claude-opus-4-8");
    expect(turn.details.declinedBy).toBeNull();
    expect(turn.details.attempts).toBeNull();
  });

  it("keeps every attempt's usage, the declined one included", () => {
    const entry = {
      input_tokens: 10,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_creation: null,
    };
    const turn = replyOf(
      message({
        model: "claude-opus-4-8",
        usage: {
          ...message().usage,
          iterations: [
            { ...entry, type: "message", model: null },
            { ...entry, output_tokens: 42, type: "fallback_message", model: "claude-opus-4-8" },
          ],
        },
      }),
      "claude-opus-5-5",
    );
    expect(turn.details.attempts?.map((attempt) => attempt.model)).toEqual(["claude-opus-5-5", "claude-opus-4-8"]);
  });

  it("notes that a reply was cut off at the length you asked for", () => {
    expect(replyOf(message({ stop_reason: "max_tokens" })).details.stopReason).toBe("max_tokens");
  });
});

describe("counting what a chat would send", () => {
  // The API refuses a count with no messages at all, so a chat nobody has spoken in yet has to
  // carry a stand-in. Without this, the token line never appears on a new chat.
  it("stands in for the first message when nothing has been said", () => {
    expect(messagesToCount([])).toEqual([{ role: "user", content: "." }]);
  });

  it("counts the real messages once there are any", () => {
    expect(messagesToCount([said, answered])).toEqual([said, answered]);
  });
});

describe("what the page is told while a reply is written", () => {
  const event = (raw: unknown) => eventOf(raw as Anthropic.Beta.BetaRawMessageStreamEvent);

  it("passes text through as it arrives", () => {
    expect(event({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Sit" } })).toEqual({
      type: "delta",
      text: "Sit",
    });
  });

  it("says when the model starts thinking", () => {
    expect(event({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } })).toEqual(
      {
        type: "thinking",
      },
    );
  });

  it("says nothing about events the page has no use for", () => {
    expect(event({ type: "message_start", message: message() })).toBeNull();
    expect(event({ type: "content_block_stop", index: 0 })).toBeNull();
    expect(event({ type: "message_stop" })).toBeNull();
  });
});
