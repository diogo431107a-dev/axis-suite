import { describe, expect, it } from "vitest";
import { linesOf, numbered } from "./lines.ts";

describe("a reply cut into lines", () => {
  it("keeps actions apart from speech, sentence by sentence, without the asterisks", () => {
    expect(linesOf("*Waves.* Hello there. How are you?")).toEqual([
      { text: "Waves.", action: true, paragraph: true },
      { text: "Hello there.", action: false, paragraph: false },
      { text: "How are you?", action: false, paragraph: false },
    ]);
  });

  it("marks where a paragraph starts", () => {
    expect(linesOf("Hi.\n\n*She leaves.* Bye.").map((line) => line.paragraph)).toEqual([true, true, false]);
  });

  it("ends a sentence after a closing quote, and keeps one that has no ending", () => {
    expect(linesOf('She said "Go." Then left. and then')).toEqual([
      { text: 'She said "Go."', action: false, paragraph: true },
      { text: "Then left.", action: false, paragraph: false },
      { text: "and then", action: false, paragraph: false },
    ]);
  });

  it("covers the reply's words exactly, and nothing else", () => {
    const reply = "*Leans in, smiling.* You came back… I knew you would! *A pause.*\n\nSit. Please.";
    const words = (text: string) => text.replace(/\*+/g, "").split(/\s+/).filter(Boolean);
    expect(
      words(
        linesOf(reply)
          .map((line) => line.text)
          .join(" "),
      ),
    ).toEqual(words(reply));
  });

  it("is numbered for Claude, each marked as speech or action", () => {
    expect(numbered(linesOf("*Waves.* Hello."))).toBe("1. (action) Waves.\n2. (speech) Hello.");
  });
});
