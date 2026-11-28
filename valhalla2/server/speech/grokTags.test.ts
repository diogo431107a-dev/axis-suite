import { describe, expect, it } from "vitest";
import { FEELINGS, STRENGTHS, type ToneLine } from "../../shared/protocol.ts";
import { grokVoice } from "./engine.ts";
import type { GrokReading } from "./grok.ts";
import { directedGrok, grokWords, plainGrok, tagsFor } from "./grokTags.ts";

const line = (text: string, fields: Partial<ToneLine> = {}): ToneLine => ({
  text,
  action: false,
  paragraph: false,
  feeling: "neutral",
  strength: 2,
  ...fields,
});

describe("Grok's tags", () => {
  it("reads a neutral line as its words", () => {
    expect(directedGrok([line("Hello.")])).toBe("Hello.");
  });

  it("reads stronger feelings with more tags, the outermost first", () => {
    expect(directedGrok([line("Go.", { feeling: "sad", strength: 1 })])).toBe("<slow>Go.</slow>");
    expect(directedGrok([line("Go.", { feeling: "sad", strength: 3 })])).toBe(
      "<slow><soft><lower-pitch>Go.</lower-pitch></soft></slow>",
    );
    expect(directedGrok([line("Shh.", { feeling: "whispering" })])).toBe("<whisper>Shh.</whisper>");
  });

  it("has tags, or none, for every feeling and strength", () => {
    for (const feeling of FEELINGS) for (const strength of STRENGTHS) expect(tagsFor(feeling, strength)).toBeDefined();
  });

  it("wraps lines next to each other with the same tags together, within a paragraph", () => {
    const lines = [
      line("Shh.", { feeling: "whispering" }),
      line("Listen.", { feeling: "whispering" }),
      line("Now!", { feeling: "shouting" }),
      line("Shh.", { feeling: "whispering", paragraph: true }),
    ];
    expect(directedGrok(lines)).toBe("<whisper>Shh. Listen.</whisper> <loud>Now!</loud>\n\n<whisper>Shh.</whisper>");
  });

  it("says a line's sound just before its words", () => {
    expect(directedGrok([line("I miss you.", { feeling: "tender", strength: 1, sound: "sigh" })])).toBe(
      "<soft>[sigh] I miss you.</soft>",
    );
    expect(directedGrok([line("Got you.", { sound: "chuckle" })])).toBe("[chuckle] Got you.");
  });

  it("keeps the reply's own brackets from being taken for tags", () => {
    expect(grokWords("[laughs] <b>No</b>")).toBe("(laughs) bNo/b");
    expect(plainGrok("A [note].")).toBe("A (note).");
    expect(directedGrok([line("[ok]", { feeling: "calm" })])).toBe("<slow>(ok)</slow>");
  });

  it("reads through the engine with the voice's own id and the speed", async () => {
    const asked: GrokReading[] = [];
    const engine = grokVoice({
      synthesize: async (reading) => {
        asked.push(reading);
        return new Uint8Array([1]);
      },
      voices: async () => [],
    });
    await engine.read({
      voice: "grok:ara",
      text: "Hi.",
      lines: null,
      tuning: { rate: -50, pitch: 30, style: null },
      styles: [],
    });
    expect(asked).toEqual([{ text: "Hi.", voiceId: "ara", speed: 0.7 }]);
    expect(engine.tune!({ rate: 20, pitch: 30, style: "calm" })).toEqual({ rate: 20, pitch: 0, style: null });
  });
});
