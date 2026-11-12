import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS, type Character, type Persona, type Turn } from "../shared/protocol.ts";
import type { Store } from "./store.ts";

const windows = vi.hoisted(() => ({ refusals: 0 }));

// Windows refusing a rename, which is what a virus scanner or the search indexer looks like from
// here. Everything else about the file system stays real.
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    rename: async (from: string, to: string) => {
      if (windows.refusals > 0) {
        windows.refusals -= 1;
        throw Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" });
      }
      return real.rename(from, to);
    },
  };
});

const dir = mkdtempSync(join(tmpdir(), "valhalla-log-"));
const { createConversations } = await import("./log.ts");

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const maid: Character = {
  id: "maid-0001",
  name: "Luvia",
  personality: "Dry, and kinder than she lets on.",
  appearance: "An apron, and flour on one cheek.",
  behavior: "Stay in character as Luvia.",
  settings: { ...DEFAULT_SETTINGS },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const master: Persona = {
  id: "master-0001",
  name: "Diro",
  description: "The man of the house, reading by the fire.",
  appearance: "A coat he has not taken off.",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

// Only the four readers matter here: nothing in a conversation writes a character or a persona.
const store = {
  characters: async () => [maid],
  character: async () => maid,
  personas: async () => [master],
  persona: async () => master,
  saveCharacter: async () => maid,
  removeCharacter: async () => {},
  savePersona: async () => master,
  removePersona: async () => {},
} as unknown as Store;

const turn = (role: Turn["role"], text: string, at: string): Turn => ({
  id: `${role}-${at}`,
  at,
  role,
  content: [{ type: "text", text }],
});

async function conversation(id: string) {
  const conversations = createConversations(store, dir);
  await conversations.create({ id, characterId: maid.id, personaId: master.id });
  return conversations;
}

describe("adding turns to a conversation", () => {
  it("writes the turn and the reply as a pair", async () => {
    const conversations = await conversation("pair-0001");
    const mine = turn("user", "Is the kettle on?", "2026-11-10T02:31:08.338Z");
    const reply = turn("assistant", "It has been, Master.", "2026-11-10T02:31:12.381Z");
    await conversations.appendTurns("pair-0001", mine, reply);
    const page = await conversations.page("pair-0001");
    expect(page.turns.map((at) => at.role)).toEqual(["user", "assistant"]);
    expect(page.conversation.updatedAt).toBe(reply.at);
  });

  it("keeps the turns when the time on them cannot be written, rather than losing the reply", async () => {
    // The log is the conversation; conversation.json only carries the time the list sorts by.
    // Reporting a failure here is what makes someone send a message that was already answered.
    const conversations = await conversation("locked-0001");
    const mine = turn("user", "I'm quick to judge women.", "2026-11-10T02:31:08.338Z");
    const reply = turn("assistant", "A flaw you have just corrected, Master.", "2026-11-10T02:31:12.381Z");
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    windows.refusals = Number.MAX_SAFE_INTEGER;
    await expect(conversations.appendTurns("locked-0001", mine, reply)).resolves.toBeUndefined();
    windows.refusals = 0;
    expect(said).toHaveBeenCalledOnce();
    said.mockRestore();
    const page = await conversations.page("locked-0001");
    expect(page.turns).toHaveLength(2);
  });
});
