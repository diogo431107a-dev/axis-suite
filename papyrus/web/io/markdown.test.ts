import { describe, expect, it } from "vitest";
import type { ExportFile } from "../../shared/protocol.ts";
import { markdownText, toMarkdown } from "./markdown.ts";

describe("markdownText", () => {
  it("keeps line breaks inside a paragraph, and paragraphs apart", () => {
    expect(markdownText("one\ntwo\n\nthree")).toBe("one  \ntwo\n\nthree");
  });
  it("escapes what Markdown would read as headings, quotes and rules", () => {
    expect(markdownText("# not a heading\n#tag stays\n> not a quote\n---\n=\n- - -\n***\n- a list")).toBe(
      "\\# not a heading  \n#tag stays  \n\\> not a quote  \n\\---  \n\\=  \n\\- - -  \n\\***  \n- a list",
    );
  });
});

describe("toMarkdown", () => {
  it("writes each journal, day and mood", () => {
    const file: ExportFile = {
      format: "papyrus",
      version: 1,
      exportedAt: "2026-10-12T10:00:00.000Z",
      journals: [
        {
          name: "Diary",
          color: "amber",
          template: null,
          pages: [
            { date: "2026-10-12", text: "A good day.", mood: 4, createdAt: "", updatedAt: "" },
            { date: "2026-10-13", text: "", mood: 2, createdAt: "", updatedAt: "" },
          ],
        },
      ],
      templates: [],
      settings: { prompts: null, weekStart: null },
    };
    expect(toMarkdown(file)).toBe(
      "# Diary\n\n## 2026-10-12, Monday\n\n*Mood: Good*\n\nA good day.\n\n## 2026-10-13, Tuesday\n\n*Mood: Bad*\n",
    );
  });
});
