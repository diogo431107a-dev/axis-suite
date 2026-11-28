import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Companion, type Message } from "../../shared/protocol.ts";
import { DEFAULT_PROMPTS } from "../../shared/prompts.ts";
import { draftOf } from "../pictures/draft.ts";
import { backgroundOf, plainPictureRequest, renderSheet, sceneRequest } from "./context.ts";

const companion: Companion = {
  id: "comp-0001",
  name: "Freya",
  profile: "<appearance>Gold hair, green eyes.</appearance>",
  settings: DEFAULT_SETTINGS,
  prompts: {},
  voice: null,
  voiceFeeling: true,
  voiceTuning: { rate: 0, pitch: 0, style: null },
  provider: "anthropic",
  memory: true,
  createdAt: "",
  updatedAt: "",
};

let next = 1;
const said = (role: Message["role"], text: string): Message => ({
  id: next++,
  parentId: null,
  role,
  content: [
    { type: "thinking", thinking: "hidden" },
    { type: "text", text },
  ],
  instruction: role === "assistant" ? "a hidden note" : null,
  isGreeting: false,
  at: "",
  editedAt: null,
  reply: null,
});

const nothing = backgroundOf(companion, { files: [], pins: [] });

describe("what Claude is given to write a picture's prompt", () => {
  it("is the profile and a portrait request for a profile picture", () => {
    const { system, prompt } = sceneRequest(companion, { kind: "profile" }, "", nothing, 1000);
    expect(system).toBe(DEFAULT_PROMPTS.picture);
    expect(prompt).toContain("<appearance>Gold hair, green eyes.</appearance>");
    expect(prompt).toContain("profile picture of Freya");
    expect(prompt).not.toContain("<chat>");
  });

  it("is the end of the chat for a chat picture, the chosen message marked, words only", () => {
    const path = [said("user", "Marry me."), said("assistant", ""), said("assistant", "Yes, under the old oak.")];
    const { prompt } = sceneRequest(companion, { kind: "chat", path }, "", nothing, 1000);
    expect(prompt).toContain('<message speaker="The user">\nMarry me.\n</message>');
    expect(prompt).toContain('<moment speaker="Freya">\nYes, under the old oak.\n</moment>');
    expect(prompt).not.toContain("hidden");
    expect(prompt.match(/<message /g)).toHaveLength(1);
  });

  it("reads the chat back as far as its budget allows, and the note you add", () => {
    // A line is about 10 tokens, a reply with its hidden note 13: the moment and three before it fit in 50.
    const path = Array.from({ length: 30 }, (_, n) => said(n % 2 ? "assistant" : "user", `Line ${n}.`));
    const { prompt } = sceneRequest(companion, { kind: "chat", path }, "  at sunset ", nothing, 50);
    expect(prompt).not.toContain("Line 25.");
    expect(prompt).toContain("Line 26.");
    expect(prompt).toContain('<moment speaker="Freya">\nLine 29.');
    expect(prompt).toContain("The user's note for this picture: at sunset");
  });

  it("uses the companion's own picture instructions when it has them", () => {
    const own = { ...companion, prompts: { picture: "Photographs only." } };
    expect(sceneRequest(own, { kind: "profile" }, "", nothing, 1000).system).toBe("Photographs only.");
  });

  it("uses the Grok Imagine instructions, in sentences, for an engine that reads them", () => {
    const natural = sceneRequest(companion, { kind: "profile" }, "", nothing, 1000, undefined, "natural");
    expect(natural.system).toBe(DEFAULT_PROMPTS.grokPicture);
    expect(natural.system).toContain("anime illustration");
    expect(plainPictureRequest(companion, { kind: "profile" }, "", "natural").system).toBe(DEFAULT_PROMPTS.grokPicture);
    expect(plainPictureRequest(companion, { kind: "profile" }, "").system).toBe(DEFAULT_PROMPTS.picture);
    const own = { ...companion, prompts: { grokPicture: "Watercolour only." } };
    expect(sceneRequest(own, { kind: "profile" }, "", nothing, 1000, undefined, "natural").system).toBe(
      "Watercolour only.",
    );
    expect(sceneRequest(own, { kind: "profile" }, "", nothing, 1000).system).toBe(DEFAULT_PROMPTS.picture);
  });

  it("always has the moment, even past the budget", () => {
    const path = [said("user", "A long speech. ".repeat(50)), said("assistant", "Yes.".repeat(400))];
    const { prompt } = sceneRequest(companion, { kind: "chat", path }, "", nothing, 10);
    expect(prompt).toContain('<moment speaker="Freya">');
    expect(prompt).not.toContain("A long speech.");
  });

  it("carries what the companion remembers: its memory files and pinned moments", () => {
    const background = backgroundOf(companion, {
      files: [{ path: "story/recent.md", content: "It rained all evening; both were soaked.", updatedAt: "" }],
      pins: [
        {
          id: 1,
          companionId: "comp-0001",
          chatId: null,
          messageId: null,
          speaker: "Freya",
          chatTitle: "The oak",
          text: "Always.",
          createdAt: "",
        },
      ],
    });
    const { prompt } = sceneRequest(companion, { kind: "profile" }, "", background, 1000);
    expect(prompt).toContain('<memory_file path="story/recent.md">\nIt rained all evening; both were soaked.');
    expect(prompt).toContain('[Freya, in the chat "The oak"]: "Always."');
  });
});

describe("Claude's answer", () => {
  it("is read as a draft, with an unknown shape made a portrait", () => {
    expect(
      draftOf(JSON.stringify({ prompt: " 1girl ", negativePrompt: "x", orientation: "sideways", caption: "c" })),
    ).toEqual({ prompt: "1girl", negativePrompt: "x", orientation: "portrait", caption: "c" });
  });

  it("is refused when it isn't a prompt", () => {
    expect(() => draftOf("not json")).toThrow(/wasn't a picture prompt/);
    expect(() => draftOf(JSON.stringify({ prompt: "" }))).toThrow(/empty/);
  });
});

describe("a scene as the picture prompt reads it", () => {
  it("gives each person's pose and how they are seen, and skips what an older scene lacks", () => {
    const person = {
      name: "Freya",
      appearance: "Gold hair, messy",
      clothes: "A green wool dress",
      action: "Resting",
      pose: "Lying on her side, knees drawn up",
      view: "From behind: her back and shoulders, not her face",
      mood: "Tired",
      expression: "",
    };
    const scene = renderSheet({
      place: "Her room",
      time: "Night",
      weather: "",
      light: "One candle",
      atmosphere: "Warm and dim",
      people: [person],
    });
    expect(scene).toContain(
      "Freya: looks Gold hair, messy; wears A green wool dress; pose: Lying on her side, knees drawn up; " +
        "seen From behind: her back and shoulders, not her face; doing: Resting; mood: Tired",
    );
    expect(scene).not.toContain("shows it as");
    expect(
      renderSheet({
        place: "",
        time: "",
        weather: "",
        light: "",
        atmosphere: "",
        people: [{ ...person, pose: "", view: "" }],
      }),
    ).not.toContain("pose:");
  });
});
