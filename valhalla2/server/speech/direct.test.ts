import { describe, expect, it } from "vitest";
import type { SceneLine } from "../../shared/protocol.ts";
import { directedSsml, styleFor } from "./direct.ts";

const line = (text: string, feeling: SceneLine["feeling"], strength: SceneLine["strength"] = 2, more = {}) =>
  ({ text, action: false, paragraph: false, feeling, strength, ...more }) satisfies SceneLine;

describe("a reply read with feeling", () => {
  it("uses the voice's own style when it has one that fits, at the line's strength", () => {
    const ssml = directedSsml([line("Come closer.", "whispering", 3)], "en-US-SerenaMultilingualNeural", [
      "whispering",
      "sad",
    ]);
    expect(ssml).toContain('xmlns:mstts="https://www.w3.org/2001/mstts"');
    expect(ssml).toContain('xml:lang="en-US"');
    expect(ssml).toContain('<mstts:express-as style="whispering" styledegree="1.6">Come closer.</mstts:express-as>');
  });

  it("falls back to a near style, then to speed, pitch and volume", () => {
    expect(styleFor("teasing", ["cheerful", "sad"])).toBe("cheerful");
    expect(styleFor("teasing", ["sad"])).toBeNull();
    const ssml = directedSsml([line("Get out.", "angry")], "pt-BR-FranciscaNeural", ["calm"]);
    expect(ssml).toContain('<prosody rate="+8%" pitch="+3%" volume="+20%">Get out.</prosody>');
    expect(ssml).not.toContain("express-as");
  });

  it("says a slight feeling half as much, and a neutral line plainly", () => {
    const ssml = directedSsml([line("Fine.", "sad", 1), line("Yes.", "neutral")], "pt-BR-FranciscaNeural", []);
    expect(ssml).toContain('<prosody rate="-6%" pitch="-3%" volume="-7%">Fine.</prosody> Yes.</voice>');
  });

  it("pauses between paragraphs, and escapes the words", () => {
    const ssml = directedSsml(
      [line("A & B.", "neutral", 2, { paragraph: true }), line("<C>", "neutral", 2, { paragraph: true })],
      "pt-BR-FranciscaNeural",
      [],
    );
    expect(ssml).toContain('<voice name="pt-BR-FranciscaNeural">A &amp; B. <break time="400ms"/>&lt;C&gt;</voice>');
  });
});
