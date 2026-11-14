import { describe, expect, it } from "vitest";
import { dollarsFor, dollarsOf } from "./price.ts";

const tokens = (over = {}) => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  ...over,
});

describe("what a turn cost", () => {
  it("charges 1.25 times input for the 5-minute cache and twice for the hour", () => {
    // Opus 5.5: $4 per million input tokens.
    expect(dollarsFor("claude-opus-5-5", tokens({ cache_creation_input_tokens: 1_000_000 }))).toBeCloseTo(5);
    expect(
      dollarsFor(
        "claude-opus-5-5",
        tokens({ cache_creation_input_tokens: 1_000_000, cache_creation_1h_input_tokens: 1_000_000 }),
      ),
    ).toBeCloseTo(8);
  });

  it("uses Haiku's dearer rate for a prompt over 100K tokens", () => {
    expect(dollarsFor("claude-haiku-5-5", tokens({ input_tokens: 100_000 }))).toBeCloseTo(0.01);
    expect(dollarsFor("claude-haiku-5-5", tokens({ input_tokens: 200_000 }))).toBeCloseTo(0.1);
  });

  it("knows the older models a declined turn can go to", () => {
    expect(dollarsFor("claude-opus-4-8", tokens({ output_tokens: 1_000_000 }))).toBeCloseTo(25);
  });

  it("adds up every attempt, and gives up on an unknown model", () => {
    const usage = tokens({ input_tokens: 1_000_000 });
    const attempts = [
      { ...usage, model: "claude-opus-5-5" },
      { ...usage, model: "claude-opus-4-8" },
    ];
    const turn = { model: "claude-opus-5-5", usage, attempts };
    expect(dollarsOf(turn)).toBeCloseTo(9);
    expect(dollarsOf({ ...turn, attempts: [{ ...usage, model: "claude-unknown" }] })).toBeNull();
  });
});
