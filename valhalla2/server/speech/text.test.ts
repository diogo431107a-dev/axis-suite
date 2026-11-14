import { describe, expect, it } from "vitest";
import { spokenText, ssmlOf } from "./text.ts";

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
