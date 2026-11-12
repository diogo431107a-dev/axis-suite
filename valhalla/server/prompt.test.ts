import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Character, type Persona } from "../shared/protocol.ts";
import { buildSystem } from "./prompt.ts";

const king: Character = {
  id: "king-0001",
  name: "Hrothgar",
  personality: "Proud, and tired of being proud.",
  appearance: "Grey-bearded, in a mail shirt he no longer needs.",
  behavior: "Stay in character as Hrothgar. Write only his words and actions, never mine.",
  settings: { ...DEFAULT_SETTINGS },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

const servant: Persona = {
  id: "servant-0001",
  name: "Eadric",
  description: "A cup-bearer who hears everything and repeats none of it.",
  appearance: "Thin, in borrowed clothes.",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("the system prompt", () => {
  it("is the character, then the persona", () => {
    const system = buildSystem(king, servant, DEFAULT_SETTINGS);
    expect(system).toHaveLength(2);
    expect(system[0]?.text).toContain("# Hrothgar");
    expect(system[1]?.text).toContain("# Speaking with you: Eadric");
  });

  it("holds every word of both definitions and adds no sentence of its own", () => {
    const text = buildSystem(king, servant, DEFAULT_SETTINGS)
      .map((block) => block.text)
      .join("\n");
    for (const written of [king.personality, king.appearance, king.behavior, servant.description, servant.appearance]) {
      expect(text).toContain(written);
    }
    // Everything that is not one of your fields is a heading.
    const extra = text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .filter((line) => !line.startsWith("#"))
      .filter((line) => ![king.personality, king.appearance, king.behavior].includes(line))
      .filter((line) => ![servant.description, servant.appearance].includes(line));
    expect(extra).toEqual([]);
  });

  it("puts the cache breakpoint on the last block and nowhere else", () => {
    const system = buildSystem(king, servant, DEFAULT_SETTINGS);
    expect(system[0]?.cache_control).toBeUndefined();
    expect(system[1]?.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("uses the cache lifetime the conversation asks for", () => {
    const system = buildSystem(king, servant, { ...DEFAULT_SETTINGS, cacheTtl: "5m" });
    expect(system[1]?.cache_control?.ttl).toBe("5m");
  });

  // The prompt cache matches bytes. If two calls with the same character and persona differ by
  // even one character, every turn of every conversation is paid for at full price, silently.
  it("is byte-identical across calls with the same character and persona", () => {
    const once = JSON.stringify(buildSystem(king, servant, DEFAULT_SETTINGS));
    const again = JSON.stringify(buildSystem(king, servant, DEFAULT_SETTINGS));
    expect(again).toBe(once);
  });

  it("carries no date, id or anything else that changes between requests", () => {
    const text = buildSystem(king, servant, DEFAULT_SETTINGS)
      .map((block) => block.text)
      .join("\n");
    expect(text).not.toContain(king.id);
    expect(text).not.toContain(servant.id);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(text).not.toMatch(new RegExp(String(new Date().getFullYear())));
  });

  it("leaves out a heading whose field is empty, rather than showing an empty one", () => {
    const bare: Character = { ...king, personality: "She says little.", appearance: "", behavior: "" };
    const text = buildSystem(bare, servant, DEFAULT_SETTINGS)[0]?.text ?? "";
    expect(text).toContain("## Personality");
    expect(text).not.toContain("## Appearance");
    expect(text).not.toContain("## Behavior");
  });

  it("changes when a definition changes, so the cache is rebuilt for the new one", () => {
    const before = JSON.stringify(buildSystem(king, servant, DEFAULT_SETTINGS));
    const after = JSON.stringify(buildSystem({ ...king, personality: "Proud still." }, servant, DEFAULT_SETTINGS));
    expect(after).not.toBe(before);
  });
});
