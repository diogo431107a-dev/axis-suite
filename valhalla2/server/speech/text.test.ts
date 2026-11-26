import { describe, expect, it } from "vitest";
import { combine, spokenText, ssmlOf } from "./text.ts";

describe("spokenText", () => {
  it("drops the asterisks around actions and keeps their words", () => {
    expect(spokenText("*She smiles.* Hello there. **Very** well.")).toBe("She smiles. Hello there. Very well.");
  });

  it("tidies spaces and blank lines", () => {
    expect(spokenText("  One.   Two. \n\n\n\n  *Three.*  ")).toBe("One. Two.\n\nThree.");
  });

  it("is empty when there are only asterisks", () => {
    expect(spokenText("** * **")).toBe("");
  });

  it("leaves Portuguese as it is", () => {
    expect(spokenText("*Ela sorri.* Olá, tudo bem? Coração, ação, você.")).toBe(
      "Ela sorri. Olá, tudo bem? Coração, ação, você.",
    );
  });
});

describe("ssmlOf", () => {
  it("wraps the text in the voice, in the voice's language", () => {
    expect(ssmlOf("Hi.", "en-US-AvaMultilingualNeural")).toBe(
      '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">' +
        '<voice name="en-US-AvaMultilingualNeural">Hi.</voice></speak>',
    );
  });

  it("escapes everything XML would read as markup", () => {
    const ssml = ssmlOf(`Tom & "Jerry" <b>'run'</b>`, "pt-BR-FranciscaNeural");
    expect(ssml).toContain(">Tom &amp; &quot;Jerry&quot; &lt;b&gt;&apos;run&apos;&lt;/b&gt;</voice>");
    expect(ssml).toContain('xml:lang="pt-BR"');
  });
});

describe("a voice set faster, higher, or in a style", () => {
  it("leaves the SSML as it was when nothing is changed", () => {
    expect(ssmlOf("Hi.", "en-US-AvaMultilingualNeural", { rate: 0, pitch: 0, style: null })).toBe(
      ssmlOf("Hi.", "en-US-AvaMultilingualNeural"),
    );
  });

  it("reads at the speed and pitch asked for", () => {
    const ssml = ssmlOf("Hi.", "pt-BR-FranciscaNeural", { rate: 15, pitch: -4, style: null });
    expect(ssml).toContain(
      '<voice name="pt-BR-FranciscaNeural"><prosody rate="+15%" pitch="-4%">Hi.</prosody></voice>',
    );
    expect(ssml).not.toContain("mstts");
  });

  it("reads in the style asked for, with speed and pitch inside it", () => {
    const ssml = ssmlOf("Hi.", "en-US-JennyNeural", { rate: -10, pitch: 0, style: "chat" });
    expect(ssml).toContain('xmlns:mstts="https://www.w3.org/2001/mstts"');
    expect(ssml).toContain('<mstts:express-as style="chat"><prosody rate="-10%">Hi.</prosody></mstts:express-as>');
  });

  it("puts one change on top of another, within what Azure takes", () => {
    expect(combine(10, 10, -50, 100)).toBeCloseTo(21);
    expect(combine(-40, -40, -50, 100)).toBe(-50);
    expect(combine(0, 8, -50, 100)).toBeCloseTo(8);
  });
});
