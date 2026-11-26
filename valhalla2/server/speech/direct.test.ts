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

describe("a reply read with feeling, in a voice set faster, higher, or in a style", () => {
  const tuning = { rate: 20, pitch: 10, style: "chat" };

  it("reads a line with no feeling in the companion's style, speed and pitch", () => {
    const ssml = directedSsml([line("Yes.", "neutral")], "en-US-JennyNeural", ["chat", "sad"], tuning);
    expect(ssml).toContain(
      '<mstts:express-as style="chat"><prosody rate="+20%" pitch="+10%">Yes.</prosody></mstts:express-as>',
    );
  });

  it("puts a feeling's speed and pitch on top of the companion's", () => {
    // Angry is 8% faster and 3% higher: 1.2 × 1.08 and 1.1 × 1.03.
    const ssml = directedSsml([line("Get out.", "angry")], "en-US-JennyNeural", ["chat"], tuning);
    expect(ssml).toContain(
      '<mstts:express-as style="chat"><prosody rate="+30%" pitch="+13%" volume="+20%">Get out.</prosody></mstts:express-as>',
    );
  });

  it("lets a feeling's own style win, keeping the companion's speed and pitch", () => {
    const ssml = directedSsml([line("Oh.", "sad")], "en-US-JennyNeural", ["chat", "sad"], tuning);
    expect(ssml).toContain(
      '<mstts:express-as style="sad" styledegree="1.2"><prosody rate="+20%" pitch="+10%">Oh.</prosody></mstts:express-as>',
    );
  });

  it("never goes past what Azure takes", () => {
    const fast = { rate: 100, pitch: 50, style: null };
    const ssml = directedSsml([line("Now!", "excited", 3)], "pt-BR-FranciscaNeural", [], fast);
    expect(ssml).toContain('<prosody rate="+100%" pitch="+50%" volume="+15%">Now!</prosody>');
  });
});
