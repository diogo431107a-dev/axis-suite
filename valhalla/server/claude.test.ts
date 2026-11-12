import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_SETTINGS, type Turn } from "../shared/protocol.ts";
import { eventOf, messagesToCount, requestFor, turnOf } from "./claude.ts";
import type { SystemBlock } from "./prompt.ts";

const system: SystemBlock[] = [
  { type: "text", text: "# Hrothgar" },
  { type: "text", text: "# Speaking with you: Eadric", cache_control: { type: "ephemeral", ttl: "1h" } },
];

const said: Turn = {
  id: "turn-1",
  at: "2026-11-09T12:00:00.000Z",
  role: "user",
  content: [{ type: "text", text: "My lord." }],
};

const answered: Turn = {
  id: "turn-2",
  at: "2026-11-09T12:00:01.000Z",
  role: "assistant",
  content: [
    { type: "thinking", thinking: "", signature: "abc" },
    { type: "text", text: "Sit down, Eadric." },
  ],
};

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
  it("sends the system blocks, the history and the chosen settings", () => {
    const request = requestFor(system, [said, answered], { ...DEFAULT_SETTINGS, maxTokens: 2048, effort: "medium" });
    expect(request.model).toBe("claude-opus-5-5");
    expect(request.max_tokens).toBe(2048);
    expect(request.output_config).toEqual({ effort: "medium" });
    expect(request.system).toBe(system);
    expect(request.messages).toHaveLength(2);
  });

  it("sends every content block back exactly as it was stored, thinking blocks included", () => {
    const request = requestFor(system, [said, answered], DEFAULT_SETTINGS);
    expect(request.messages[1]).toEqual({ role: "assistant", content: answered.content });
  });

  it("follows the conversation with a second cache breakpoint", () => {
    const request = requestFor(system, [said], { ...DEFAULT_SETTINGS, cacheTtl: "1h" });
    expect(request.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("asks for thinking the only way these models accept, and never sets a temperature", () => {
    const request = requestFor(system, [said], DEFAULT_SETTINGS);
    expect(request.thinking).toEqual({ type: "adaptive" });
    expect(request).not.toHaveProperty("temperature");
    expect(request).not.toHaveProperty("top_p");
    expect(request).not.toHaveProperty("top_k");
  });

  it("asks for a fallback model when the conversation allows one", () => {
    const request = requestFor(system, [said], { ...DEFAULT_SETTINGS, fallbacks: true });
    expect(request.fallbacks).toBe("default");
    expect(request.betas).toEqual(["server-side-fallback-2026-07-01"]);
  });

  it("asks for none when it doesn't", () => {
    const request = requestFor(system, [said], { ...DEFAULT_SETTINGS, fallbacks: false });
    expect(request.fallbacks).toBeUndefined();
    expect(request.betas).toBeUndefined();
  });

  it("leaves stop sequences out entirely when there are none", () => {
    expect(requestFor(system, [said], DEFAULT_SETTINGS).stop_sequences).toBeUndefined();
    const withStops = requestFor(system, [said], { ...DEFAULT_SETTINGS, stopSequences: ["\nEadric:"] });
    expect(withStops.stop_sequences).toEqual(["\nEadric:"]);
  });
});

describe("what gets stored after a reply", () => {
  it("keeps the content, the model, how it ended and what it cost", () => {
    const turn = turnOf(message());
    expect(turn.role).toBe("assistant");
    expect(turn.content).toEqual([{ type: "text", text: "Sit down, Eadric." }]);
    expect(turn.model).toBe("claude-opus-5-5");
    expect(turn.stopReason).toBe("end_turn");
    expect(turn.usage).toEqual({
      input_tokens: 11,
      output_tokens: 42,
      cache_read_input_tokens: 4096,
      cache_creation_input_tokens: 120,
    });
    expect(turn.servedBy).toBeNull();
  });

  // A refusal is an answer the API gave, so it is kept like any other turn and shown as it is.
  it("stores a refusal as a turn, with the category and explanation the API named", () => {
    const turn = turnOf(
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
    expect(turn.stopReason).toBe("refusal");
    expect(turn.stopDetails).toEqual({ category: "general_harms", explanation: "The request was declined." });
  });

  it("names the model that answered when an earlier one declined", () => {
    const turn = turnOf(
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
    expect(turn.servedBy).toBe("claude-opus-4-8");
    expect(turn.stopReason).toBe("end_turn");
  });

  it("notes that a reply was cut off at the length you asked for", () => {
    expect(turnOf(message({ stop_reason: "max_tokens" })).stopReason).toBe("max_tokens");
  });
});

describe("counting what a conversation would send", () => {
  // The API refuses a count with no messages at all, so a conversation nobody has spoken in yet
  // has to carry a stand-in. Without this, the token line never appeared on a new conversation.
  it("stands in for the first message when nothing has been said", () => {
    expect(messagesToCount([])).toEqual([{ role: "user", content: "." }]);
  });

  it("counts the real turns once there are any", () => {
    expect(messagesToCount([said, answered])).toEqual([
      { role: "user", content: said.content },
      { role: "assistant", content: answered.content },
    ]);
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
