import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, LIMITS } from "../shared/protocol.ts";
import { DEFAULT_PROMPTS } from "../shared/prompts.ts";
import { createChats } from "./chat/chats.ts";
import { createCompanions } from "./companions.ts";
import { openDatabase } from "./db.ts";
import { promptFor } from "./memory/consolidate.ts";
import { renderMemory, snapshotFor } from "./memory/inject.ts";
import { createMemory } from "./memory/store.ts";
import { createQuiet, quietBlock, quietOf } from "./quiet.ts";

const MEMORY_LIMITS = { fileBytes: 8192, storyBytes: 16384, files: 20, viewChars: 16_000 };

function setup() {
  const db = openDatabase(":memory:");
  const companions = createCompanions(db, "odin", DEFAULT_SETTINGS);
  const companion = companions.save("comp-0001", { name: "Lina", profile: "A doll." });
  const chats = createChats(db, "odin", companions, 5);
  chats.create({ id: "chat-0001", companionId: companion.id, title: "The storm" });
  chats.create({ id: "chat-0002", companionId: companion.id, title: "Morning" });
  const memory = createMemory(db, MEMORY_LIMITS);
  // Chats that have just been active keep the snapshot they have.
  db.prepare("UPDATE chats SET last_activity_at = ?").run(new Date().toISOString());
  return { db, companion, companions, chats, memory, quiet: createQuiet(db, companions) };
}

describe("topics to leave alone", () => {
  it("are kept in order, and every chat with the companion looks again at once", () => {
    const { db, companion, memory, quiet } = setup();
    snapshotFor(db, memory, "chat-0001", companion);
    snapshotFor(db, memory, "chat-0002", companion);
    quiet.add(companion.id, { text: "  The cellar  " });
    quiet.add(companion.id, { text: "The old debt" });
    expect(quietOf(db, companion.id).map((topic) => topic.text)).toEqual(["The cellar", "The old debt"]);

    for (const chatId of ["chat-0001", "chat-0002"]) {
      const snapshot = snapshotFor(db, memory, chatId, companion);
      expect(snapshot).toContain(
        `<leave_alone>\n${DEFAULT_PROMPTS.quiet}\n- The cellar\n- The old debt\n</leave_alone>`,
      );
    }
  });

  it("are sent after the memory and the pins, and not at all when there are none", () => {
    const { companion } = setup();
    const topics = [{ id: 1, text: "The cellar", createdAt: "" }];
    const pins = [
      {
        id: 1,
        companionId: companion.id,
        chatId: null,
        messageId: null,
        speaker: "Lina",
        chatTitle: "The storm",
        text: "Always.",
        createdAt: "",
      },
    ];
    const rendered = renderMemory(companion, [], "canon", pins, topics);
    expect(rendered.indexOf("<pinned_moments>")).toBeLessThan(rendered.indexOf("<leave_alone>"));
    expect(renderMemory(companion, [], "canon", pins, [])).not.toContain("<leave_alone>");
  });

  it("can be let go again, by their owner only", () => {
    const { db, companion, chats, quiet } = setup();
    const topic = quiet.add(companion.id, { text: "The cellar" });
    const freya = createQuiet(db, createCompanions(db, "freya", DEFAULT_SETTINGS));
    expect(() => freya.remove(companion.id, topic.id)).toThrow(/No such companion/);
    quiet.remove(companion.id, topic.id);
    expect(quietOf(db, companion.id)).toEqual([]);
    expect(() => quiet.remove(companion.id, topic.id)).toThrow(/No such topic/);
    expect(chats.list()).toHaveLength(2);
  });

  it("refuses an empty one, and more than the limit", () => {
    const { companion, quiet } = setup();
    expect(() => quiet.add(companion.id, { text: "  " })).toThrow(/can't be empty/);
    for (let n = 0; n < LIMITS.quiet; n++) quiet.add(companion.id, { text: `Topic ${n}` });
    expect(() => quiet.add(companion.id, { text: "One more" })).toThrow(/at most/);
  });

  it("are shown to the memory model, which is told what to do with them", () => {
    const { companion } = setup();
    const topics = [{ id: 1, text: "The cellar", createdAt: "" }];
    expect(quietBlock(topics)).toEqual(["<leave_alone>\n- The cellar\n</leave_alone>"]);
    expect(quietBlock([])).toEqual([]);
    const prompt = promptFor(
      companion,
      [],
      {
        chat: { id: "chat-0001", title: "The storm", mode: "canon" } as never,
        path: [],
        fresh: [],
        corrections: [],
        feedback: [],
        praise: [],
        modeChanged: false,
        needed: true,
      } as never,
      topics,
    );
    expect(prompt).toContain("<leave_alone>\n- The cellar\n</leave_alone>");
    expect(DEFAULT_PROMPTS.consolidation).toContain("<leave_alone>");
    expect(DEFAULT_PROMPTS.cleanup).toContain("<leave_alone>");
  });
});
