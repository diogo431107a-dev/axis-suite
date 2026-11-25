import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Companion, type Message } from "../../shared/protocol.ts";
import { DEFAULT_PROMPTS } from "../../shared/prompts.ts";
import { draftOf } from "../claude/pictures.ts";
import { sceneRequest } from "./scene.ts";

const companion: Companion = {
  id: "comp-0001",
  name: "Freya",
  profile: "<appearance>Gold hair, green eyes.</appearance>",
  settings: DEFAULT_SETTINGS,
  prompts: {},
  voice: null,
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

describe("what Claude is given to write a picture's prompt", () => {
  it("is the profile and a portrait request for a profile picture", () => {
    const { system, prompt } = sceneRequest(companion, { kind: "profile" }, "", 20);
    expect(system).toBe(DEFAULT_PROMPTS.picture);
    expect(prompt).toContain("<appearance>Gold hair, green eyes.</appearance>");
    expect(prompt).toContain("profile picture of Freya");
    expect(prompt).not.toContain("<chat>");
  });

  it("is the end of the chat for a chat picture, the chosen message marked, words only", () => {
    const path = [said("user", "Marry me."), said("assistant", ""), said("assistant", "Yes, under the old oak.")];
    const { prompt } = sceneRequest(companion, { kind: "chat", path }, "", 20);
    expect(prompt).toContain('<message speaker="The user">\nMarry me.\n</message>');
    expect(prompt).toContain('<moment speaker="Freya">\nYes, under the old oak.\n</moment>');
    expect(prompt).not.toContain("hidden");
    expect(prompt.match(/<message /g)).toHaveLength(1);
  });

  it("reads only the last few messages, and the note you add", () => {
    const path = Array.from({ length: 30 }, (_, n) => said(n % 2 ? "assistant" : "user", `Line ${n}.`));
    const { prompt } = sceneRequest(companion, { kind: "chat", path }, "  at sunset ", 5);
    expect(prompt).not.toContain("Line 24.");
    expect(prompt).toContain("Line 25.");
    expect(prompt).toContain('<moment speaker="Freya">\nLine 29.');
    expect(prompt).toContain("The user's note for this picture: at sunset");
  });

  it("uses the companion's own picture instructions when it has them", () => {
    const own = { ...companion, prompts: { picture: "Photographs only." } };
    expect(sceneRequest(own, { kind: "profile" }, "", 20).system).toBe("Photographs only.");
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
